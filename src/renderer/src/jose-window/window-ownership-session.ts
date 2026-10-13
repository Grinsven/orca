import type { JoseWindowOwnershipFrame } from '../../../shared/rpc-contract/jose-window-params'
import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { AppState } from '@/store/types'
import { setWindowOwnershipView } from './ownership-guard'
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
  claim: (target: RuntimeClientTarget, worktreeId: string | null) => Promise<boolean>
  reveal: (target: RuntimeClientTarget, worktreeId: string) => Promise<boolean>
  raise: () => void
  activateHere: (worktreeId: string) => void
  isMissingMethod: (error: unknown) => boolean
  /** Returns a canceller. */
  setTimer?: (callback: () => void, ms: number) => () => void
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
let loggedUnsupported = false

/** Only worktrees served by the ownership host are shared between windows. */
export function claimableWorktreeId(state: AppState, target: RuntimeClientTarget): string | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId || isFloatingWorkspaceId(worktreeId)) {
    return null
  }
  const owner = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  const host = target.kind === 'environment' ? target.environmentId : null
  return owner === host ? worktreeId : null
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
    reveal: (worktreeId: string) => deps.reveal(target, worktreeId),
    activateHere: deps.activateHere
  }
  let stopped = false
  let unsupported = false
  let generation = 0
  let handle: { unsubscribe: () => void } | null = null
  let cancelRetry: (() => void) | null = null
  let retryMs = RETRY_MIN_MS
  // The host's record of our claim; undefined until a snapshot arrives on the current stream.
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
    const worktreeId = claimableWorktreeId(deps.store.getState(), target)
    if (worktreeId === ownedHere) {
      return
    }
    claiming = true
    try {
      const claimed = await deps.claim(target, worktreeId)
      if (stopped) {
        return
      }
      ownedHere = claimed ? worktreeId : null
      const state = deps.store.getState()
      if (!claimed && worktreeId !== null && state.activeWorktreeId === worktreeId) {
        state.setActiveWorktree(null)
      }
    } catch (error) {
      if (deps.isMissingMethod(error)) {
        markUnsupported()
      } else {
        console.warn('[jose-window] claim failed', error)
      }
    } finally {
      claiming = false
      if (claimAgain) {
        claimAgain = false
        void syncClaim()
      }
    }
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
      console.info(`[jose-window] reveal received for ${frame.worktreeId}`)
      deps.raise()
      return
    }
    retryMs = RETRY_MIN_MS
    ownedHere = frame.ownedHere
    setWindowOwnershipView({ link, ownedElsewhere: frame.ownedElsewhere })
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
      state.worktreesByRepo !== previous.worktreesByRepo ||
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
