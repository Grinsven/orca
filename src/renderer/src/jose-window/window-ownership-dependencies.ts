import type {
  JoseWindowNavigationIntent,
  JoseWindowClaimSetParams,
  JoseWindowClaimSetResult,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { AppState } from '@/store/types'
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
  claimSet?: (
    target: RuntimeClientTarget,
    params: JoseWindowClaimSetParams
  ) => Promise<JoseWindowClaimSetResult>
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
