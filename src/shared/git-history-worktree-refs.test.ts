import { describe, expect, it } from 'vitest'
import {
  buildGitHistoryWorktreesByBranch,
  findGitHistoryWorktreeForRefs
} from './git-history-worktree-refs'
import type { GitHistoryItemRef } from './git-history-types'

const WORKTREES = [
  { id: 'repo::/a', repoId: 'repo', branch: 'refs/heads/feature', displayName: 'Feature work' },
  { id: 'repo::/b', repoId: 'repo', branch: 'refs/heads/main', displayName: '' },
  { id: 'repo::/c', repoId: 'repo', branch: '', displayName: 'Detached' },
  { id: 'other::/d', repoId: 'other', branch: 'refs/heads/feature', displayName: 'Other repo' }
]

describe('git history worktree refs', () => {
  it('indexes branches of the active repo by short branch name', () => {
    const byBranch = buildGitHistoryWorktreesByBranch(WORKTREES, { repoId: 'repo' })

    expect([...byBranch.keys()].sort()).toEqual(['feature', 'main'])
  })

  it('falls back to the branch name when the workspace has no display name', () => {
    const byBranch = buildGitHistoryWorktreesByBranch(WORKTREES, { repoId: 'repo' })

    expect(byBranch.get('main')).toEqual({ worktreeId: 'repo::/b', displayName: 'main' })
  })

  it('indexes nothing when the active repo is unresolved, instead of matching every repo', () => {
    expect(buildGitHistoryWorktreesByBranch(WORKTREES, { repoId: null }).size).toBe(0)
    expect(buildGitHistoryWorktreesByBranch(WORKTREES).size).toBe(0)
  })

  it('excludes the workspace the panel is already showing', () => {
    const byBranch = buildGitHistoryWorktreesByBranch(WORKTREES, {
      repoId: 'repo',
      excludeWorktreeId: 'repo::/a'
    })

    expect(byBranch.has('feature')).toBe(false)
  })

  it('matches only local branch refs, never remote-tracking refs of the same name', () => {
    const byBranch = buildGitHistoryWorktreesByBranch(WORKTREES, { repoId: 'repo' })
    const refs: GitHistoryItemRef[] = [
      { id: 'refs/remotes/origin/main', name: 'main', category: 'remote branches' },
      { id: 'refs/tags/v1', name: 'feature', category: 'tags' }
    ]

    expect(findGitHistoryWorktreeForRefs(refs, byBranch)).toBeUndefined()
  })

  it('resolves the workspace holding a branch ref on the commit', () => {
    const byBranch = buildGitHistoryWorktreesByBranch(WORKTREES, { repoId: 'repo' })
    const refs: GitHistoryItemRef[] = [
      { id: 'refs/heads/feature', name: 'feature', category: 'branches' }
    ]

    expect(findGitHistoryWorktreeForRefs(refs, byBranch)?.displayName).toBe('Feature work')
  })
})
