import type { JoseWindowNavigationIntent } from '../../../shared/rpc-contract/jose-window-params'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  hostSessionTabIdsByLocalTabForWorktree,
  resolveLocalTabIdForHostSessionTab
} from '@/runtime/web-session-tabs-sync/tracking-mappings'

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
  target: RuntimeClientTarget
): JoseWindowIntentRequest {
  return {
    worktreeId,
    ...(target.kind === 'environment' ? { runtimeEnvironmentId: target.environmentId } : {}),
    intent
  }
}
