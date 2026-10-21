import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { GitFileStatus, GitStatusEntry } from '../../../../shared/git-status-types'

// 'branch' is T3's "Changes": merge base to the working tree. 'uncommitted' is HEAD to the working tree.
export type ChangesScope = 'branch' | 'uncommitted'

/** One file in the view; the same path never shows twice, unlike Orca's per-area sections. */
export type ChangesFileEntry = {
  path: string
  oldPath?: string
  status: GitFileStatus
  added?: number
  removed?: number
  /** The committed change on the branch (merge base to HEAD), Changes scope only. */
  branch?: GitBranchChangeEntry
  /** Uncommitted rows git reports for this path (staged, unstaged, untracked). */
  worktree: GitStatusEntry[]
}

function isRenderableStatusEntry(entry: GitStatusEntry): boolean {
  // Why: unresolved conflicts may not exist on disk, and submodule-internal rows are read-only views.
  return entry.conflictStatus !== 'unresolved' && entry.submoduleRoot === undefined
}

function mergeWorktreeStatus(rows: readonly GitStatusEntry[]): GitFileStatus {
  if (rows.some((row) => row.status === 'deleted' && row.area !== 'staged')) {
    return 'deleted'
  }
  if (rows.some((row) => row.area === 'untracked' || row.status === 'untracked')) {
    return 'untracked'
  }
  if (rows.some((row) => row.status === 'added')) {
    return 'added'
  }
  if (rows.some((row) => row.status === 'deleted')) {
    return 'deleted'
  }
  return (
    rows.find((row) => row.status === 'renamed' || row.status === 'copied')?.status ?? 'modified'
  )
}

function singleCount(
  rows: readonly GitStatusEntry[],
  field: 'added' | 'removed'
): number | undefined {
  // Why: staged and unstaged counts are separate diffs; their sum is not HEAD to working tree.
  return rows.length === 1 ? rows[0][field] : undefined
}

function groupWorktreeRows(
  statusEntries: readonly GitStatusEntry[]
): Map<string, GitStatusEntry[]> {
  const byPath = new Map<string, GitStatusEntry[]>()
  for (const entry of statusEntries) {
    if (!isRenderableStatusEntry(entry)) {
      continue
    }
    const rows = byPath.get(entry.path)
    if (rows) {
      rows.push(entry)
    } else {
      byPath.set(entry.path, [entry])
    }
  }
  return byPath
}

function worktreeOldPath(rows: readonly GitStatusEntry[]): string | undefined {
  return rows.find((row) => row.oldPath !== undefined)?.oldPath
}

function compareByPath(a: ChangesFileEntry, b: ChangesFileEntry): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

export function buildUncommittedChangesEntries(
  statusEntries: readonly GitStatusEntry[]
): ChangesFileEntry[] {
  const entries: ChangesFileEntry[] = []
  for (const [path, rows] of groupWorktreeRows(statusEntries)) {
    entries.push({
      path,
      oldPath: worktreeOldPath(rows),
      status: mergeWorktreeStatus(rows),
      added: singleCount(rows, 'added'),
      removed: singleCount(rows, 'removed'),
      worktree: rows
    })
  }
  return entries.sort(compareByPath)
}

function mergeBranchAndWorktreeStatus(
  branch: GitBranchChangeEntry,
  rows: readonly GitStatusEntry[]
): GitFileStatus {
  const worktreeStatus = mergeWorktreeStatus(rows)
  if (worktreeStatus === 'deleted') {
    return branch.status === 'added' ? 'modified' : 'deleted'
  }
  return branch.status === 'added' ? 'added' : branch.status
}

export function buildBranchChangesEntries(
  branchEntries: readonly GitBranchChangeEntry[],
  statusEntries: readonly GitStatusEntry[]
): ChangesFileEntry[] {
  const worktreeByPath = groupWorktreeRows(statusEntries)
  const entries: ChangesFileEntry[] = []
  for (const branch of branchEntries) {
    const rows = worktreeByPath.get(branch.path)
    worktreeByPath.delete(branch.path)
    entries.push({
      path: branch.path,
      oldPath: branch.oldPath,
      status: rows ? mergeBranchAndWorktreeStatus(branch, rows) : branch.status,
      added: rows ? undefined : branch.added,
      removed: rows ? undefined : branch.removed,
      branch,
      worktree: rows ?? []
    })
  }
  for (const [path, rows] of worktreeByPath) {
    entries.push({
      path,
      oldPath: worktreeOldPath(rows),
      status: mergeWorktreeStatus(rows),
      added: singleCount(rows, 'added'),
      removed: singleCount(rows, 'removed'),
      worktree: rows
    })
  }
  return entries.sort(compareByPath)
}

/** Stable identity of what each file's diff depends on; a change reloads that file only. */
export function getChangesEntryVersion(entry: ChangesFileEntry): string {
  const rows = entry.worktree
    .map((row) => `${row.area}:${row.status}:${row.added ?? ''}:${row.removed ?? ''}`)
    .join(',')
  const branch = entry.branch
    ? `${entry.branch.status}:${entry.branch.added ?? ''}:${entry.branch.removed ?? ''}`
    : ''
  return `${entry.oldPath ?? ''}|${entry.status}|${branch}|${rows}`
}
