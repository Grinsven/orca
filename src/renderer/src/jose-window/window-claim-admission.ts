import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { WindowOwnershipDeps } from './window-ownership-dependencies'
import type { WindowClaimAuthority } from './window-claim-authority'
import type { WindowWorkspaceRef } from './window-workspace-claims'
import { ownershipKey } from './ownership-ref'
import { resolveWindowClaimPlan } from './window-claim-plan'
import { bindWindowWorkspaceAdmission, type WorkspaceAdmission } from './window-workspace-admission'

export function createWindowClaimAdmission(options: {
  target: RuntimeClientTarget
  deps: WindowOwnershipDeps
  authorities: ReadonlyMap<string, WindowClaimAuthority>
  scope: () => readonly WindowWorkspaceRef[]
}) {
  return bindWindowWorkspaceAdmission(() =>
    options.scope().map((ref): WorkspaceAdmission => {
      const plan = resolveWindowClaimPlan(options.deps.store.getState(), options.target, [ref])
      if (!plan || plan.size === 0) {
        return { ref, status: 'pending' }
      }
      for (const [key, entry] of plan) {
        const authority = options.authorities.get(key)
        if (authority?.status() === 'unsupported') {
          return { ref, status: 'refused' }
        }
        if (
          !authority ||
          authority.status() !== 'ready' ||
          !entry.refs.every((requested) =>
            authority.owned().some((owned) => ownershipKey(requested) === ownershipKey(owned))
          )
        ) {
          return { ref, status: 'pending' }
        }
      }
      return { ref, status: 'owned' }
    })
  )
}
