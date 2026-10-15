import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { JoseWindowWorktreeRef } from '../../../shared/rpc-contract/jose-window-params'
import type { WindowOwnershipDeps } from './window-ownership-dependencies'
import type { WindowClaimAuthority } from './window-claim-authority'
import type { WindowWorkspaceRef } from './window-workspace-claims'
import { resolveOwnershipRef } from './ownership-ref'
import { resolveWindowClaimPlan } from './window-claim-plan'

const matches = (a: WindowWorkspaceRef, b: WindowWorkspaceRef): boolean =>
  a.worktreeId === b.worktreeId && a.executionHostId === b.executionHostId

/** A refused claim leaves the view on a workspace the connected authorities still grant it. */
export function restoreRefusedWindowClaims(options: {
  deps: WindowOwnershipDeps
  target: RuntimeClientTarget
  authorities: ReadonlyMap<string, WindowClaimAuthority>
  active: WindowWorkspaceRef | null
  wasPinned: boolean
  primaryRefused: (ref: JoseWindowWorktreeRef) => void
}): void {
  const { deps, target, authorities, active, wasPinned, primaryRefused } = options
  const state = deps.store.getState()
  if (
    !wasPinned &&
    (!active ||
      state.activeWorktreeId !== active.worktreeId ||
      (state.activeWorkspaceExecutionHostId &&
        state.activeWorkspaceExecutionHostId !== active.executionHostId))
  ) {
    return
  }
  const primaryRef =
    active && resolveOwnershipRef(state, target, active.worktreeId, active.executionHostId)
  if (!wasPinned && primaryRef) {
    primaryRefused(primaryRef)
    return
  }
  const owned = [...authorities.values()].flatMap((port) =>
    port.status() === 'ready' ? port.viewRefs(port.owned()) : []
  )
  const focused = active && owned.find((ref) => matches(ref, active))
  const candidates = focused ? [focused, ...owned.filter((ref) => !matches(ref, focused))] : owned
  if (!candidates.some((ref) => deps.activateHere(ref.worktreeId, ref.executionHostId))) {
    state.setActiveWorktree(null)
  }
  if (!wasPinned && active) {
    const plan = resolveWindowClaimPlan(state, target, [active])
    for (const entry of plan?.values() ?? []) {
      const ref = entry.refs[0]
      if (ref) {
        void deps.reveal(entry.target, ref).catch((error: unknown) => {
          console.warn('[jose-window] reveal unverifiable', error)
        })
      }
    }
  }
}
