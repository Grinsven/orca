import type { GitHistoryItemRef } from './git-history-types'

export type GitHistoryWorktreeRef = {
  worktreeId: string
  displayName: string
}

type WorktreeBranchCheckout = {
  id: string
  repoId: string
  /** Full ref (`refs/heads/x`) or short name; empty for a detached HEAD. */
  branch?: string | null
  displayName?: string
}

/**
 * Indexes the repo's workspaces by the local branch each has checked out, so history rows can mark
 * refs that are open elsewhere in Orca. Detached workspaces have no branch and are skipped.
 *
 * Without a repo id the index stays empty: branch names collide across repos (main, master, dev),
 * so an unresolved repo must mark nothing rather than claim every workspace in the app.
 */
export function buildGitHistoryWorktreesByBranch(
  worktrees: Iterable<WorktreeBranchCheckout>,
  options: { repoId?: string | null; excludeWorktreeId?: string | null } = {}
): Map<string, GitHistoryWorktreeRef> {
  const byBranch = new Map<string, GitHistoryWorktreeRef>()
  if (!options.repoId) {
    return byBranch
  }
  for (const worktree of worktrees) {
    if (worktree.repoId !== options.repoId) {
      continue
    }
    if (options.excludeWorktreeId && worktree.id === options.excludeWorktreeId) {
      continue
    }
    const branchName = (worktree.branch ?? '').replace(/^refs\/heads\//, '').trim()
    // Git allows one checkout per branch, so the first match is the only match.
    if (!branchName || byBranch.has(branchName)) {
      continue
    }
    byBranch.set(branchName, {
      worktreeId: worktree.id,
      displayName: worktree.displayName?.trim() || branchName
    })
  }
  return byBranch
}

export function findGitHistoryWorktreeForRefs(
  refs: readonly GitHistoryItemRef[],
  worktreesByBranch: ReadonlyMap<string, GitHistoryWorktreeRef>
): GitHistoryWorktreeRef | undefined {
  for (const ref of refs) {
    if (ref.category !== 'branches') {
      continue
    }
    const match = worktreesByBranch.get(ref.name)
    if (match) {
      return match
    }
  }
  return undefined
}
