import {
  JoseWindowNavigationIntent,
  type JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { WindowOwnershipDeps } from './window-ownership-session'
import { activeOwnershipRef, keyOf, ownershipKey, viewExecutionHostId } from './ownership-ref'
import { intentRequest, toViewIntent } from './navigation-intent'

/** Reveals an accepted visible workspace, ignoring requests that crossed a layout change. */
export function revealOwnedWorkspace(
  target: RuntimeClientTarget,
  deps: WindowOwnershipDeps,
  owns: (ref: JoseWindowWorktreeRef) => boolean,
  ref: JoseWindowWorktreeRef,
  rawIntent: unknown
): void {
  if (owns(ref) && keyOf(activeOwnershipRef(deps.store.getState(), target)) !== ownershipKey(ref)) {
    if (!deps.activateHere(ref.worktreeId, viewExecutionHostId(ref, target))) {
      return
    }
  }
  const state = deps.store.getState()
  if (keyOf(activeOwnershipRef(state, target)) !== ownershipKey(ref)) {
    console.info(`[jose-window] obsolete reveal for ${ref.worktreeId} ignored`)
    return
  }
  const parsed = JoseWindowNavigationIntent.safeParse(rawIntent)
  const intent = parsed.success ? parsed.data : null
  if (intent && intent.kind !== 'workspace') {
    deps.applyIntent(
      intentRequest(
        ref.worktreeId,
        toViewIntent(intent, target, ref.worktreeId),
        target,
        viewExecutionHostId(ref, target)
      )
    )
  } else if (state.activeView !== 'terminal') {
    state.setActiveView('terminal')
  }
  deps.raise()
}
