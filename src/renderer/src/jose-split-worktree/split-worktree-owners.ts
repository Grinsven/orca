import type { ExecutionHostId } from '../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { retainedSplitWorkspace, type SplitWorkspaceRef } from './split-worktree-state'

/** Keeps a visible workspace's owner stable while keyboard focus moves to its neighbor. */
export function withSplitWorkspaceOwner<
  T extends {
    activeWorktreeId?: string | null
    activeWorkspaceExecutionHostId?: ExecutionHostId | null
  }
>(state: T, worktreeId: string): T {
  const retained = retainedSplitWorkspace(worktreeId)
  if (
    !retained ||
    (state.activeWorktreeId === worktreeId &&
      state.activeWorkspaceExecutionHostId === retained.executionHostId)
  ) {
    return state
  }
  return {
    ...state,
    activeWorktreeId: worktreeId,
    activeWorkspaceExecutionHostId: retained.executionHostId
  }
}

export function applySplitFolderOwners<T extends { id: string; folderPath: string }>(
  surfaces: { id: string; path: string }[],
  folders: readonly T[],
  hostOf: (folder: T) => ExecutionHostId | null,
  owners: readonly SplitWorkspaceRef[] = []
): void {
  for (const folder of folders) {
    const id = folderWorkspaceKey(folder.id)
    const retained = owners.find((ref) => ref.worktreeId === id)
    if (!retained || hostOf(folder) !== retained.executionHostId) {
      continue
    }
    const surface = surfaces.find((candidate) => candidate.id === id)
    if (surface) {
      surface.path = folder.folderPath
    }
  }
}
