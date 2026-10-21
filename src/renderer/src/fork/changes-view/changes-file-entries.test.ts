import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import {
  buildBranchChangesEntries,
  buildUncommittedChangesEntries,
  getChangesEntryVersion
} from './changes-file-entries'

function row(entry: Partial<GitStatusEntry> & Pick<GitStatusEntry, 'path'>): GitStatusEntry {
  return { status: 'modified', area: 'unstaged', ...entry }
}

describe('buildUncommittedChangesEntries', () => {
  it('shows a path once when it is both staged and unstaged', () => {
    const entries = buildUncommittedChangesEntries([
      row({ path: 'src/a.ts', area: 'staged', added: 2, removed: 1 }),
      row({ path: 'src/a.ts', area: 'unstaged', added: 5, removed: 0 }),
      row({ path: 'new.txt', status: 'untracked', area: 'untracked', added: 1 })
    ])
    expect(entries.map((entry) => [entry.path, entry.status, entry.worktree.length])).toEqual([
      ['new.txt', 'untracked', 1],
      ['src/a.ts', 'modified', 2]
    ])
    // Staged plus unstaged counts are two diffs; their sum is not HEAD to working tree.
    expect(entries[1].added).toBeUndefined()
    expect(entries[0].added).toBe(1)
  })

  it('skips unresolved conflicts and submodule-internal rows', () => {
    const entries = buildUncommittedChangesEntries([
      row({ path: 'conflict.ts', conflictStatus: 'unresolved', conflictKind: 'both_modified' }),
      row({ path: 'inner.ts', submoduleRoot: 'vendor/lib' }),
      row({ path: 'kept.ts' })
    ])
    expect(entries.map((entry) => entry.path)).toEqual(['kept.ts'])
  })

  it('keeps the old path of a staged rename', () => {
    const [entry] = buildUncommittedChangesEntries([
      row({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed', area: 'staged' })
    ])
    expect(entry).toMatchObject({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed' })
  })

  it('reports a working tree deletion over a staged edit', () => {
    const [entry] = buildUncommittedChangesEntries([
      row({ path: 'gone.ts', area: 'staged' }),
      row({ path: 'gone.ts', status: 'deleted', area: 'unstaged' })
    ])
    expect(entry.status).toBe('deleted')
  })
})

describe('buildBranchChangesEntries', () => {
  it('merges committed and uncommitted changes into one row per path', () => {
    const entries = buildBranchChangesEntries(
      [
        { path: 'both.ts', status: 'modified', added: 3, removed: 1 },
        { path: 'committed.ts', status: 'added', added: 10 },
        { path: 'moved.ts', oldPath: 'old.ts', status: 'renamed' }
      ],
      [
        row({ path: 'both.ts' }),
        row({ path: 'only-local.ts', status: 'untracked', area: 'untracked' })
      ]
    )
    expect(
      entries.map((entry) => [entry.path, entry.status, !!entry.branch, entry.worktree.length])
    ).toEqual([
      ['both.ts', 'modified', true, 1],
      ['committed.ts', 'added', true, 0],
      ['moved.ts', 'renamed', true, 0],
      ['only-local.ts', 'untracked', false, 1]
    ])
    // A committed count no longer describes merge base to working tree once the file is edited again.
    expect(entries[0].added).toBeUndefined()
    expect(entries[1].added).toBe(10)
    expect(entries[2].oldPath).toBe('old.ts')
  })

  it('treats a file added on the branch and deleted locally as gone from the base view', () => {
    const [deleted, addedThenRemoved] = buildBranchChangesEntries(
      [
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'added' }
      ],
      [row({ path: 'a.ts', status: 'deleted' }), row({ path: 'b.ts', status: 'deleted' })]
    )
    expect(deleted.status).toBe('deleted')
    expect(addedThenRemoved.status).toBe('modified')
  })
})

describe('getChangesEntryVersion', () => {
  it('changes when a row count changes so only that file reloads', () => {
    const [before] = buildUncommittedChangesEntries([row({ path: 'a.ts', added: 1 })])
    const [same] = buildUncommittedChangesEntries([row({ path: 'a.ts', added: 1 })])
    const [after] = buildUncommittedChangesEntries([row({ path: 'a.ts', added: 2 })])
    expect(getChangesEntryVersion(same)).toBe(getChangesEntryVersion(before))
    expect(getChangesEntryVersion(after)).not.toBe(getChangesEntryVersion(before))
  })
})
