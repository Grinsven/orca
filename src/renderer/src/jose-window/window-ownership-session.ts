import type {
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { AppState } from '@/store/types'
import { setWindowOwnershipView } from './ownership-guard'
import {
  activeOwnershipRef,
  ownershipKey,
  resolveOwnershipRef,
  viewExecutionHostId
} from './ownership-ref'
import type { OwnershipSubscriptionCallbacks } from './window-ownership-client'

type OwnershipStore = {
  getState: () => AppState
  subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void
}

export type WindowOwnershipDeps = {
  store: OwnershipStore
  subscribe: (
    target: RuntimeClientTarget,
    callbacks: OwnershipSubscriptionCallbacks
  ) => Promise<{ unsubscribe: () => void }>
  claim: (target: RuntimeClientTarget, ref: JoseWindowWorktreeRef | null) => Promise<boolean>
  reveal: (target: RuntimeClientTarget, ref: JoseWindowWorktreeRef) => Promise<boolean>
  raise: () => void
  activateHere: (worktreeId: string, executionHostId: ExecutionHostId | undefined) => void
  isMissingMethod: (error: unknown) => boolean
  /** Returns a canceller. */
  setTimer?: (callback: () => void, ms: number) => () => void
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
let loggedUnsupported = false

const keyOf = (ref: JoseWindowWorktreeRef | null): string | null => (ref ? ownershipKey(ref) : null)

/** Snapshot refs, reading an older host's bare ids as its own checkouts. */
function snapshotRefs(frame: Extract<JoseWindowOwnershipFrame, { type: 'snapshot' }>): {
  elsewhere: JoseWindowWorktreeRef[]
  here: JoseWindowWorktreeRef | null
} {
  const local = (worktreeId: string): JoseWindowWorktreeRef => ({
    worktreeId,
    executionHostId: 'local'
  })
  return {
    elsewhere: frame.ownedElsewhereRefs ?? frame.ownedElsewhere.map(local),
    here:
      frame.ownedHereRef !== undefined
        ? frame.ownedHereRef
        : frame.ownedHere
          ? local(frame.ownedHere)
          : null
  }
}

/**
 * Keeps this window's active worktree claimed on the host and the other windows' claims cached
 * for the click guard. A refused claim deselects, which covers every path that skips the guard
 * (CLI focus, file open --focus, notification clicks, startup restore).
 */
export function startWindowOwnership(
  target: RuntimeClientTarget,
  deps: WindowOwnershipDeps
): () => void {
  const setTimer =
    deps.setTimer ??
    ((callback, ms) => {
      const handle = setTimeout(callback, ms)
      return () => clearTimeout(handle)
    })
  const link = {
    resolve: (worktreeId: string, executionHostId?: ExecutionHostId | null) =>
      resolveOwnershipRef(deps.store.getState(), target, worktreeId, executionHostId),
    reveal: (ref: JoseWindowWorktreeRef) => deps.reveal(target, ref),
    activateHere: (ref: JoseWindowWorktreeRef) =>
      deps.activateHere(ref.worktreeId, viewExecutionHostId(ref, target))
  }
  let stopped = false
  let unsupported = false
  let generation = 0
  let handle: { unsubscribe: () => void } | null = null
  let cancelRetry: (() => void) | null = null
  let retryMs = RETRY_MIN_MS
  // The host's record of our claim (an ownership key); undefined until a snapshot arrives on the current stream.
  let ownedHere: string | null | undefined
  let claiming = false
  let claimAgain = false

  const markUnsupported = (): void => {
    unsupported = true
    if (!loggedUnsupported) {
      loggedUnsupported = true
      console.info('[jose-window] host has no window ownership methods; windows stay independent')
    }
    teardownStream()
  }

  const syncClaim = async (): Promise<void> => {
    if (stopped || unsupported || ownedHere === undefined) {
      return
    }
    if (claiming) {
      claimAgain = true
      return
    }
    const ref = activeOwnershipRef(deps.store.getState(), target)
    const key = keyOf(ref)
    if (key === ownedHere) {
      return
    }
    claiming = true
    // Why: a reply that crosses a reconnect answers the old stream; the new stream's snapshot is
    // the truth, so the reply is dropped and the claim re-synced against it.
    const claimGeneration = generation
    let stale = false
    try {
      const claimed = await deps.claim(target, ref)
      stale = claimGeneration !== generation
      if (stopped || stale) {
        return
      }
      ownedHere = claimed ? key : null
      const state = deps.store.getState()
      if (!claimed && key !== null && keyOf(activeOwnershipRef(state, target)) === key) {
        state.setActiveWorktree(null)
      }
    } catch (error) {
      stale = claimGeneration !== generation
      if (deps.isMissingMethod(error)) {
        markUnsupported()
      } else {
        console.warn('[jose-window] claim failed', error)
      }
    } finally {
      claiming = false
      if (claimAgain || stale) {
        claimAgain = false
        void syncClaim()
      }
    }
  }

  // Why: a reveal is only worth raising for while this window still shows that workspace; one that
  // crossed a newer selection here must not raise (or switch to) the old one.
  const revealHere = (ref: JoseWindowWorktreeRef): void => {
    const state = deps.store.getState()
    if (keyOf(activeOwnershipRef(state, target)) !== ownershipKey(ref)) {
      console.info(`[jose-window] obsolete reveal for ${ref.worktreeId} ignored`)
      return
    }
    // Tasks or Settings keep the active worktree; the reveal asks for its workspace surface.
    if (state.activeView !== 'terminal') {
      state.setActiveView('terminal')
    }
    deps.raise()
  }

  const onFrame = (frameGeneration: number, frame: JoseWindowOwnershipFrame): void => {
    if (stopped || frameGeneration !== generation) {
      return
    }
    if (frame.type === 'end') {
      onStreamClosed(frameGeneration)
      return
    }
    if (frame.type === 'reveal') {
      revealHere({
        worktreeId: frame.worktreeId,
        executionHostId: frame.executionHostId ?? 'local'
      })
      return
    }
    retryMs = RETRY_MIN_MS
    const refs = snapshotRefs(frame)
    ownedHere = keyOf(refs.here)
    setWindowOwnershipView({ link, ownedElsewhere: refs.elsewhere })
    void syncClaim()
  }

  const onStreamClosed = (closedGeneration: number): void => {
    if (stopped || unsupported || closedGeneration !== generation) {
      return
    }
    teardownStream()
    cancelRetry = setTimer(() => {
      cancelRetry = null
      void open()
    }, retryMs)
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
  }

  function teardownStream(): void {
    generation += 1
    ownedHere = undefined
    setWindowOwnershipView(null)
    handle?.unsubscribe()
    handle = null
  }

  const open = async (): Promise<void> => {
    if (stopped || unsupported) {
      return
    }
    const streamGeneration = ++generation
    try {
      const next = await deps.subscribe(target, {
        onFrame: (frame) => onFrame(streamGeneration, frame),
        onError: (error) => {
          if (deps.isMissingMethod(error)) {
            markUnsupported()
          } else {
            console.warn('[jose-window] ownership stream error', error)
          }
        },
        onClose: () => onStreamClosed(streamGeneration)
      })
      if (stopped || streamGeneration !== generation) {
        next.unsubscribe()
        return
      }
      handle = next
    } catch (error) {
      if (deps.isMissingMethod(error)) {
        markUnsupported()
        return
      }
      console.warn('[jose-window] ownership subscribe failed', error)
      onStreamClosed(streamGeneration)
    }
  }

  const stopStore = deps.store.subscribe((state, previous) => {
    if (
      state.activeWorktreeId !== previous.activeWorktreeId ||
      state.activeWorkspaceExecutionHostId !== previous.activeWorkspaceExecutionHostId ||
      state.worktreesByRepo !== previous.worktreesByRepo ||
      state.detectedWorktreesByRepo !== previous.detectedWorktreesByRepo ||
      state.repos !== previous.repos ||
      state.folderWorkspaces !== previous.folderWorkspaces
    ) {
      void syncClaim()
    }
  })
  void open()

  return () => {
    stopped = true
    stopStore()
    cancelRetry?.()
    teardownStream()
  }
}

export function resetWindowOwnershipLogForTests(): void {
  loggedUnsupported = false
}
