import type { AppState } from '@/store/types'
import { resolveStrictWorktreeOperationRouteResultForHost } from '@/lib/worktree-operation-route'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { JoseWindowWorktreeRef } from '../../../shared/rpc-contract/jose-window-params'
import type { WindowWorkspaceRef } from './window-workspace-claims'
import { resolveOwnershipRef } from './ownership-ref'
import { claimAuthorityKey } from './window-claim-authority'

export type WindowClaimPlanEntry = { target: RuntimeClientTarget; refs: JoseWindowWorktreeRef[] }

/** Resolves every group independently of the workspace that currently has keyboard focus. */
export function resolveWindowClaimPlan(
  state: AppState,
  primary: RuntimeClientTarget,
  requested: readonly WindowWorkspaceRef[]
): Map<string, WindowClaimPlanEntry> | null {
  const plan = new Map<string, WindowClaimPlanEntry>()
  for (const view of requested) {
    const route = resolveStrictWorktreeOperationRouteResultForHost(
      state,
      view.worktreeId,
      view.executionHostId
    )
    if (route.kind !== 'resolved') {
      return null
    }
    const primaryRef = resolveOwnershipRef(state, primary, view.worktreeId, view.executionHostId)
    const target: RuntimeClientTarget = primaryRef
      ? primary
      : route.route.runtimeEnvironmentId
        ? { kind: 'environment', environmentId: route.route.runtimeEnvironmentId }
        : { kind: 'local' }
    const ref =
      primaryRef ?? resolveOwnershipRef(state, target, view.worktreeId, view.executionHostId)
    if (!ref) {
      return null
    }
    const key = claimAuthorityKey(target)
    const entry = plan.get(key) ?? { target, refs: [] }
    entry.refs.push(ref)
    plan.set(key, entry)
  }
  return plan
}
