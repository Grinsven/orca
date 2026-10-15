import { describe, expect, it } from 'vitest'
import { countChangedFiles, formatGitChangeCount, gitChangeCountKey } from './git-change-count'

describe('sidebar changed file count', () => {
  it('counts a partially staged path once and includes untracked, renamed and conflicted paths', () => {
    expect(
      countChangedFiles({
        conflictOperation: 'merge',
        entries: [
          { path: 'edit.ts', area: 'staged', status: 'modified' },
          { path: 'edit.ts', area: 'unstaged', status: 'modified' },
          { path: 'new.ts', area: 'untracked', status: 'untracked' },
          { path: 'renamed.ts', oldPath: 'old.ts', area: 'staged', status: 'renamed' },
          {
            path: 'conflict.ts',
            area: 'unstaged',
            status: 'modified',
            conflictStatus: 'unresolved'
          }
        ]
      })
    ).toEqual({ count: 4, partial: false })
  })

  it.each([0, 1, 9, 10, 99, 100])(
    'formats %i files without widening the activity button',
    (count) => {
      expect(formatGitChangeCount({ count, partial: false })).toBe(
        count === 0 ? null : count > 99 ? '99+' : String(count)
      )
    }
  )

  it('does not present a truncated listing as an exact count', () => {
    expect([
      formatGitChangeCount({ count: 12, partial: true }),
      formatGitChangeCount({ count: 100, partial: true }),
      formatGitChangeCount(null)
    ]).toEqual(['…', '99+', null])
  })

  it('separates the same path and worktree on local, SSH and paired runtime owners', () => {
    const context = { worktreeId: 'repo::/work', worktreePath: '/work' }
    const keys = [
      gitChangeCountKey({ ...context, target: { kind: 'local' } }),
      gitChangeCountKey({ ...context, target: { kind: 'local' }, connectionId: 'ssh' }),
      gitChangeCountKey({ ...context, target: { kind: 'environment', environmentId: 'one' } }),
      gitChangeCountKey({ ...context, target: { kind: 'environment', environmentId: 'two' } }),
      gitChangeCountKey({
        ...context,
        target: { kind: 'environment', environmentId: 'one' },
        connectionId: 'ssh'
      })
    ]
    expect(new Set(keys).size).toBe(5)
  })
})
