import type { AppState } from '@/store/types'
import { resolveOwner } from '@/lib/resolve-owner'
import { hostRouteForAuthority } from '@/runtime/runtime-client-target'
import { selectKnownWorktreeById, selectRepoByIdForActiveWorkspace } from '@/store/selectors'
import { runtimeHostConnectionStateForEntry } from '@/runtime/runtime-host-connection-state'
import {
  selectRuntimeAwareSshConnectionGeneration,
  selectRuntimeAwareSshStatus
} from '@/store/slices/runtime-environment-ssh-selectors'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { parseExecutionHostId } from '../../../../shared/execution-host'

export function activeGitCountContext(state: AppState): RuntimeGitContext | null {
  const id = state.activeWorktreeId
  if (!id || parseWorkspaceKey(id)?.type === 'folder') {
    return null
  }
  const worktree = selectKnownWorktreeById(state, id)
  const repo = selectRepoByIdForActiveWorkspace(state, worktree?.repoId ?? null)
  const owner = resolveOwner(state, { workspaceId: id })
  if (!worktree || !repo || !isGitRepoKind(repo) || owner.kind !== 'resolved') {
    return null
  }
  const { target, at } = hostRouteForAuthority(owner.owner)
  const place = parseExecutionHostId(at)
  return {
    target,
    worktreeId: id,
    worktreePath: worktree.path,
    connectionId: place?.kind === 'ssh' ? place.targetId : undefined
  }
}

/** Contact and connection identity come from the same host stores as the rest of the renderer. */
export function gitCountConnectionKey(state: AppState, context: RuntimeGitContext): string | null {
  const environmentId = context.target.kind === 'environment' ? context.target.environmentId : null
  const runtime = environmentId ? state.runtimeStatusByEnvironmentId.get(environmentId) : null
  if (environmentId && runtimeHostConnectionStateForEntry(runtime) !== 'connected') {
    return null
  }
  if (
    context.connectionId &&
    selectRuntimeAwareSshStatus(state, environmentId, context.connectionId) !== 'connected'
  ) {
    return null
  }
  return JSON.stringify([
    runtime?.connectionGeneration ?? null,
    context.connectionId
      ? selectRuntimeAwareSshConnectionGeneration(state, environmentId, context.connectionId)
      : null
  ])
}
