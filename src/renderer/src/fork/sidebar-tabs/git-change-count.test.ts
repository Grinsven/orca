import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import {
  countChangedFiles,
  describeGitChangeCount,
  formatGitChangeCount,
  gitChangeCountKey
} from './git-change-count'

describe('sidebar pending change count', () => {
  it('describes exact and partial change counts in Dutch', () => {
    expect([
      describeGitChangeCount(null),
      describeGitChangeCount({ count: 1, partial: false }),
      describeGitChangeCount({ count: 42, partial: false }),
      describeGitChangeCount({ count: 12, partial: true })
    ]).toEqual(['', '1 wijziging', '42 wijzigingen', 'minstens 12 wijzigingen, telling onvolledig'])
  })
  it('counts both sides of a partially staged path alongside untracked, renamed and conflicted changes', () => {
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
    ).toEqual({ count: 5, partial: false })
  })

  it.each<[string, GitStatusEntry]>([
    ['staged', { path: 'a.ts', area: 'staged', status: 'added' }],
    ['unstaged', { path: 'a.ts', area: 'unstaged', status: 'modified' }],
    ['untracked', { path: 'a.ts', area: 'untracked', status: 'untracked' }],
    [
      'conflicted',
      { path: 'a.ts', area: 'unstaged', status: 'modified', conflictStatus: 'unresolved' }
    ]
  ])('counts a %s change', (_, entry) => {
    expect(countChangedFiles({ entries: [entry], conflictOperation: 'unknown' })).toEqual({
      count: 1,
      partial: false
    })
  })

  it('counts a staged addition edited again as two pending changes', () => {
    expect(
      countChangedFiles({
        conflictOperation: 'unknown',
        entries: [
          { path: 'new.ts', area: 'staged', status: 'added' },
          { path: 'new.ts', area: 'unstaged', status: 'modified' }
        ]
      })
    ).toEqual({ count: 2, partial: false })
  })

  it.each<[number, string | null]>([
    [0, null],
    [1, '1'],
    [9, '9'],
    [10, '10'],
    [99, '99'],
    [100, '100'],
    [999, '999'],
    [1000, '1K'],
    [1001, '1K+'],
    [1999, '1K+'],
    [2000, '2K']
  ])('formats %i changes like VS Code', (count, label) => {
    expect(formatGitChangeCount({ count, partial: false })).toBe(label)
  })

  it('matches the loaded VS Code count while retaining truncation metadata for its description', () => {
    expect([
      countChangedFiles({
        entries: [{ path: 'a.ts', area: 'unstaged', status: 'modified' }],
        conflictOperation: 'unknown',
        didHitLimit: true
      }),
      formatGitChangeCount({ count: 12, partial: true }),
      formatGitChangeCount({ count: 100, partial: true }),
      formatGitChangeCount(null)
    ]).toEqual([{ count: 1, partial: true }, '12', '100', null])
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
