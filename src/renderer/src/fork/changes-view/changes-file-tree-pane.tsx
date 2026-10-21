import { useMemo } from 'react'
import { CombinedDiffFileTree } from '@/components/editor/combined-diff/browse-files/combined-diff-file-tree'
import { getCombinedDiffFileTreeSectionKey } from '@/components/editor/combined-diff/resolve-changes/combined-diff-section-identity'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { ChangesFileEntry } from './changes-file-entries'

const NO_VIEWED_KEYS: ReadonlySet<string> = new Set()

function toTreeEntry(entry: ChangesFileEntry): GitBranchChangeEntry {
  return {
    path: entry.path,
    status: entry.status === 'untracked' ? 'added' : entry.status,
    oldPath: entry.oldPath,
    added: entry.added,
    removed: entry.removed
  }
}

export function treeKeyForPath(path: string): string {
  return getCombinedDiffFileTreeSectionKey('branch', { path, status: 'modified' })
}

// Orca's own tree (filters, virtualized rows, resize); one row per file, as in the diff list.
export function ChangesFileTreePane({
  worktreeId,
  worktreePath,
  entries,
  activePath,
  open,
  onOpenChange,
  onNavigate
}: {
  worktreeId: string
  worktreePath: string
  entries: readonly ChangesFileEntry[]
  activePath: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (path: string) => void
}): React.JSX.Element | null {
  const treeEntries = useMemo(() => entries.map(toTreeEntry), [entries])
  const indexByKey = useMemo(
    () => new Map(entries.map((entry, index) => [treeKeyForPath(entry.path), index])),
    [entries]
  )
  return (
    <CombinedDiffFileTree
      mode="branch"
      worktreePath={worktreePath}
      sourceWorkspaceId={worktreeId}
      entries={treeEntries}
      sectionIndexByKey={indexByKey}
      activeSectionKey={activePath === null ? null : treeKeyForPath(activePath)}
      viewedSectionKeys={NO_VIEWED_KEYS}
      collapsed={!open}
      onCollapsedChange={(collapsed) => onOpenChange(!collapsed)}
      onNavigate={(entry) => onNavigate(entry.path)}
    />
  )
}
