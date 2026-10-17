import type { RuntimeWorktreePsSummary } from '../shared/runtime-types'

export function psRow(
  worktreeId: string,
  overrides: Partial<RuntimeWorktreePsSummary> = {}
): RuntimeWorktreePsSummary {
  return {
    worktreeId,
    repoId: 'repo',
    repo: 'repo',
    path: `/work/${worktreeId}`,
    branch: worktreeId,
    isArchived: false,
    isMainWorktree: false,
    hasHostSidebarActivity: true,
    parentWorktreeId: null,
    childWorktreeIds: [],
    displayName: worktreeId,
    workspaceStatus: 'in-progress',
    sortOrder: 0,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: '',
    isPinned: false,
    isActive: false,
    unread: false,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    lastOutputAt: null,
    preview: '',
    status: 'active',
    agents: [],
    ...overrides
  }
}
