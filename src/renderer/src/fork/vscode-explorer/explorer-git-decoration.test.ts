import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import { buildFolderStatusMap } from '@/components/right-sidebar/status-display'
import {
  buildConflictedPathSet,
  CONFLICT_BADGE,
  FOLDER_CHANGES_BADGE,
  getExplorerStatusBadge,
  getExplorerStatusColor
} from './explorer-git-decoration'

function entry(path: string, status: GitStatusEntry['status']): GitStatusEntry {
  return { path, status, area: status === 'untracked' ? 'untracked' : 'unstaged' }
}

describe('explorer git decoration', () => {
  it('maps each file status to its VS Code letter and color token', () => {
    expect(getExplorerStatusBadge('modified', false, false)).toBe('M')
    expect(getExplorerStatusBadge('untracked', false, false)).toBe('U')
    expect(getExplorerStatusBadge('added', false, false)).toBe('A')
    expect(getExplorerStatusBadge('deleted', false, false)).toBe('D')
    expect(getExplorerStatusColor('modified', false)).toBe('var(--git-decoration-modified)')
    expect(getExplorerStatusColor('untracked', false)).toBe('var(--git-decoration-untracked)')
    expect(getExplorerStatusColor(null, false)).toBeNull()
  })

  it('marks conflicts with "!" and the conflicting color', () => {
    expect(getExplorerStatusBadge('modified', false, true)).toBe(CONFLICT_BADGE)
    expect(getExplorerStatusColor('modified', true)).toBe('var(--git-decoration-conflicting)')
  })

  it('gives folders with changes a dot in the dominant child color', () => {
    const folders = buildFolderStatusMap([
      entry('src/app/main.ts', 'modified'),
      entry('src/new.ts', 'untracked')
    ])
    const appStatus = folders.get('src/app') ?? null
    const srcStatus = folders.get('src') ?? null
    expect(appStatus).toBe('modified')
    expect(srcStatus).toBe('modified')
    expect(getExplorerStatusBadge('modified', true, false)).toBe(FOLDER_CHANGES_BADGE)
    expect(getExplorerStatusColor(srcStatus, false)).toBe('var(--git-decoration-modified)')
  })

  it('propagates unresolved conflicts to every parent folder only', () => {
    const conflicted = buildConflictedPathSet([
      { ...entry('src/app/merge.ts', 'modified'), conflictStatus: 'unresolved' },
      { ...entry('docs/done.md', 'modified'), conflictStatus: 'resolved_locally' },
      entry('lib/plain.ts', 'modified')
    ])
    expect([...conflicted].sort()).toEqual(['src', 'src/app', 'src/app/merge.ts'])
  })

  it('returns no decorations for a folder workspace without git status', () => {
    expect(buildConflictedPathSet([]).size).toBe(0)
    expect(buildFolderStatusMap([]).size).toBe(0)
  })
})
