import {
  JoseWindowNavigationIntent,
  type JoseWindowOwnershipFrame,
  type JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { AppState } from '@/store/types'
import { revealOwningWindow, setWindowOwnershipView } from './ownership-guard'
import { ClaimWaiters, setOwnershipClaimGate } from './ownership-claim-gate'
import { createClaimRetry } from './ownership-claim-retry'
import { restoreSelectionAfterRefusal, type WorkspaceSelection } from './refused-claim-restore'
import {
  activeOwnershipRef,
  keyOf,
  ownershipKey,
  snapshotRefs,
  viewExecutionHostId
} from './ownership-ref'
import type { OwnershipSubscriptionCallbacks } from './window-ownership-client'
import { createOwnershipLink, intentRequest, toViewIntent } from './navigation-intent'

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
  reveal: (
    target: RuntimeClientTarget,
    ref: JoseWindowWorktreeRef,
    intent?: JoseWindowNavigationIntent
  ) => Promise<boolean>
  raise: () => void
  /** Delivers a redirected request to this window's own UI event bridge. */
  applyIntent: (request: JoseWindowIntentRequest) => void
  /** False when the workspace no longer exists here. */
  activateHere: (worktreeId: string, executionHostId: ExecutionHostId | undefined) => boolean
  isMissingMethod: (error: unknown) => boolean
  /** Returns a canceller. */
  setTimer?: (callback: () => void, ms: number) => () => void
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
let loggedUnsupported = false

/**
 * Keeps this window's active worktree claimed on the host and the other windows' claims cached
 * for the click guard. A refused claim covers every path that skips the guard (CLI focus, file
 * open --focus, notification clicks, startup restore): the window goes back to a valid selection,
 * and for a user navigation the accepted owner is raised.
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
  const link = createOwnershipLink(target, deps)
  const claimWaiters = new ClaimWaiters(setTimer)
  const claimGate = { resolve: link.resolve, waitForClaim: (key: string) => claimWaiters.wait(key) }
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
  let ownedElsewhereKeys = new Set<string>()
  // The last selection the host accepted (or that it does not serve), for a refused claim to return to.
  let lastValidSelection: WorkspaceSelection | null = null
  // Until a claim has succeeded, a refusal comes from startup restore, not from the user.
  let hadSuccessfulClaim = false
  const claimRetry = createClaimRetry({
    setTimer,
    retry: () => void syncClaim(),
    giveUp: (key) => claimWaiters.settle(key, false)
  })

  const markUnsupported = (): void => {
    unsupported = true
    if (!loggedUnsupported) {
      loggedUnsupported = true
      console.info('[jose-window] host has no window ownership methods; windows stay independent')
    }
    teardownStream()
    claimWaiters.settleAll(true)
  }

  const restoreAfterRefusal = (refused: JoseWindowWorktreeRef): void => {
    restoreSelectionAfterRefusal({
      state: deps.store.getState(),
      target,
      refused,
      previous: lastValidSelection,
      ownedElsewhereKeys,
      activateHere: deps.activateHere
    })
    // Why: startup restore is not a request to see the other window; Jose keeps the one he launched.
    if (hadSuccessfulClaim) {
      revealOwningWindow(refused)
    }
  }

  const syncClaim = async (): Promise<void> => {
    if (stopped || unsupported || ownedHere === undefined) {
      return
    }
    if (claiming) {
      claimAgain = true
      return
    }
    const state = deps.store.getState()
    const ref = activeOwnershipRef(state, target)
    const key = keyOf(ref)
    const selection: WorkspaceSelection | null = state.activeWorktreeId
      ? {
          worktreeId: state.activeWorktreeId,
          executionHostId: state.activeWorkspaceExecutionHostId ?? undefined
        }
      : null
    claimWaiters.refuseAllBut(key)
    if (key === ownedHere) {
      if (key !== null) {
        claimWaiters.settle(key, true)
      }
      lastValidSelection = selection ?? lastValidSelection
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
      claimRetry.succeeded()
      ownedHere = claimed ? key : null
      if (key !== null) {
        claimWaiters.settle(key, claimed)
      }
      if (claimed) {
        lastValidSelection = selection ?? lastValidSelection
        hadSuccessfulClaim ||= key !== null
      } else if (ref && keyOf(activeOwnershipRef(deps.store.getState(), target)) === key) {
        restoreAfterRefusal(ref)
      }
    } catch (error) {
      stale = claimGeneration !== generation
      if (deps.isMissingMethod(error)) {
        markUnsupported()
      } else {
        console.warn('[jose-window] claim failed', error)
        if (!stale) {
          claimRetry.failed(key)
        }
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
  const revealHere = (ref: JoseWindowWorktreeRef, rawIntent: unknown): void => {
    const state = deps.store.getState()
    if (keyOf(activeOwnershipRef(state, target)) !== ownershipKey(ref)) {
      console.info(`[jose-window] obsolete reveal for ${ref.worktreeId} ignored`)
      return
    }
    const parsed = JoseWindowNavigationIntent.safeParse(rawIntent)
    const intent = parsed.success ? parsed.data : null
    if (intent && intent.kind !== 'workspace') {
      // The bridge handler switches to the terminal surface itself.
      deps.applyIntent(
        intentRequest(
          ref.worktreeId,
          toViewIntent(intent, target, ref.worktreeId),
          target,
          viewExecutionHostId(ref, target)
        )
      )
    } else if (state.activeView !== 'terminal') {
      // Tasks or Settings keep the active worktree; the reveal asks for its workspace surface.
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
      revealHere(
        { worktreeId: frame.worktreeId, executionHostId: frame.executionHostId ?? 'local' },
        frame.intent
      )
      return
    }
    retryMs = RETRY_MIN_MS
    const refs = snapshotRefs(frame)
    ownedHere = keyOf(refs.here)
    ownedElsewhereKeys = new Set(refs.elsewhere.map(ownershipKey))
    setWindowOwnershipView({ link, ownedElsewhere: refs.elsewhere })
    setOwnershipClaimGate(null)
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
    claimRetry.cancel()
    ownedHere = undefined
    ownedElsewhereKeys = new Set()
    setWindowOwnershipView(null)
    // Why: with no snapshot the guard has no evidence, so activation defers seeding to the claim.
    setOwnershipClaimGate(stopped || unsupported ? null : claimGate)
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
  setOwnershipClaimGate(claimGate)
  void open()

  return () => {
    stopped = true
    stopStore()
    cancelRetry?.()
    teardownStream()
    claimWaiters.settleAll(true)
  }
}

export function resetWindowOwnershipLogForTests(): void {
  loggedUnsupported = false
}
