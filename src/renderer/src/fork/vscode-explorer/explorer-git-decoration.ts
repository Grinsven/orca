import { joinPath } from '@/lib/path'
import type { GitFileStatus, GitStatusEntry } from '../../../../shared/git-status-types'
import { splitPathSegments } from '@/components/right-sidebar/path-tree'
import { STATUS_COLORS, STATUS_LABELS } from '@/components/right-sidebar/status-display'

export const GIT_DECORATION_CONFLICTING_COLOR = 'var(--git-decoration-conflicting)'
// VS Code badges a folder that contains changes with a dot, and a conflicted file with "!".
export const FOLDER_CHANGES_BADGE = '•'
export const CONFLICT_BADGE = '!'

/** Unresolved conflicts plus every folder above them, so folders carry the conflict color. */
export function buildConflictedPathSet(entries: readonly GitStatusEntry[]): ReadonlySet<string> {
  const conflicted = new Set<string>()
  for (const entry of entries) {
    if (entry.conflictStatus !== 'unresolved') {
      continue
    }
    let currentPath = ''
    for (const segment of splitPathSegments(entry.path)) {
      currentPath = currentPath ? joinPath(currentPath, segment) : segment
      conflicted.add(currentPath)
    }
  }
  return conflicted
}

export function getExplorerStatusColor(
  status: GitFileStatus | null,
  isConflicted: boolean
): string | null {
  if (!status) {
    return null
  }
  return isConflicted ? GIT_DECORATION_CONFLICTING_COLOR : STATUS_COLORS[status]
}

export function getExplorerStatusBadge(
  status: GitFileStatus,
  isDirectory: boolean,
  isConflicted: boolean
): string {
  if (isDirectory) {
    return FOLDER_CHANGES_BADGE
  }
  return isConflicted ? CONFLICT_BADGE : STATUS_LABELS[status]
}
