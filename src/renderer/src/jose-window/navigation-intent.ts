import type {
  JoseWindowNavigationIntent,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  hostSessionTabIdsByLocalTabForWorktree,
  resolveLocalTabIdForHostSessionTab
} from '@/runtime/web-session-tabs-sync/tracking-mappings'
import type { WindowOwnershipLink } from './ownership-guard'
import { resolveOwnershipRef, viewExecutionHostId, type OwnershipState } from './ownership-ref'

function withTabId(
  intent: JoseWindowNavigationIntent,
  map: (tabId: string) => string
): JoseWindowNavigationIntent {
  return intent.kind === 'terminal' || intent.kind === 'tab'
    ? { ...intent, tabId: map(intent.tabId) }
    : intent
}

/** This window's request in the ownership host's terms. Window 2's tabs mirror the host's under
 *  their own ids; the host window's ids already are the host's. */
export function toHostIntent(
  intent: JoseWindowNavigationIntent,
  target: RuntimeClientTarget,
  worktreeId: string
): JoseWindowNavigationIntent {
  if (target.kind !== 'environment') {
    return intent
  }
  const hostTabIdByLocal = hostSessionTabIdsByLocalTabForWorktree(target.environmentId, worktreeId)
  return withTabId(intent, (tabId) => hostTabIdByLocal.get(tabId) ?? tabId)
}

/** A host-terms request in this window's terms: the inverse of toHostIntent. */
export function toViewIntent(
  intent: JoseWindowNavigationIntent,
  target: RuntimeClientTarget,
  worktreeId: string
): JoseWindowNavigationIntent {
  if (target.kind !== 'environment') {
    return intent
  }
  const { environmentId } = target
  return withTabId(
    intent,
    (hostTabId) =>
      resolveLocalTabIdForHostSessionTab({ environmentId, worktreeId, hostTabId }) ?? hostTabId
  )
}

/** Window 2 reaches the host's files through its paired runtime; the host window reads them itself. */
export function intentRequest(
  worktreeId: string,
  intent: JoseWindowNavigationIntent,
  target: RuntimeClientTarget,
  executionHostId: ExecutionHostId | undefined
): JoseWindowIntentRequest {
  return {
    worktreeId,
    ...(target.kind === 'environment' ? { runtimeEnvironmentId: target.environmentId } : {}),
    ...(executionHostId ? { executionHostId } : {}),
    intent
  }
}

/** The validated host a replayed UI event carries (see uiEventForIntent); other senders have none. */
export function replayedExecutionHostId(payload: object): ExecutionHostId | undefined {
  return 'executionHostId' in payload && typeof payload.executionHostId === 'string'
    ? parseExecutionHostId(payload.executionHostId)?.id
    : undefined
}

/** How the click guard reaches the ownership host, and carries a request out here after all. */
export function createOwnershipLink(
  target: RuntimeClientTarget,
  deps: {
    store: { getState: () => OwnershipState }
    reveal: (
      target: RuntimeClientTarget,
      ref: JoseWindowWorktreeRef,
      intent?: JoseWindowNavigationIntent
    ) => Promise<boolean>
    applyIntent: (request: JoseWindowIntentRequest) => void
    activateHere: (worktreeId: string, executionHostId: ExecutionHostId | undefined) => boolean
  }
): WindowOwnershipLink {
  return {
    resolve: (worktreeId, executionHostId) =>
      resolveOwnershipRef(deps.store.getState(), target, worktreeId, executionHostId),
    reveal: (ref, intent) =>
      intent
        ? deps.reveal(target, ref, toHostIntent(intent, target, ref.worktreeId))
        : deps.reveal(target, ref),
    activateHere: (ref, intent) => {
      const executionHostId = viewExecutionHostId(ref, target)
      if (intent && intent.kind !== 'workspace') {
        deps.applyIntent(intentRequest(ref.worktreeId, intent, target, executionHostId))
        return
      }
      deps.activateHere(ref.worktreeId, executionHostId)
    }
  }
}
