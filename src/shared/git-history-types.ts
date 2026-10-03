export type GitHistoryGraphColorId =
  | 'git-graph-ref'
  | 'git-graph-remote-ref'
  | 'git-graph-base-ref'
  | 'git-graph-lane-1'
  | 'git-graph-lane-2'
  | 'git-graph-lane-3'
  | 'git-graph-lane-4'
  | 'git-graph-lane-5'

export const GIT_HISTORY_REF_COLOR: GitHistoryGraphColorId = 'git-graph-ref'
export const GIT_HISTORY_REMOTE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-remote-ref'
export const GIT_HISTORY_BASE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-base-ref'

export const GIT_HISTORY_LANE_COLORS: readonly GitHistoryGraphColorId[] = [
  'git-graph-lane-1',
  'git-graph-lane-2',
  'git-graph-lane-3',
  'git-graph-lane-4',
  'git-graph-lane-5'
]

export const GIT_HISTORY_DEFAULT_LIMIT = 50
export const GIT_HISTORY_MAX_LIMIT = 200

export type GitHistoryRefCategory = 'branches' | 'remote branches' | 'tags' | 'commits'

export type GitHistoryItemRef = {
  id: string
  name: string
  revision?: string
  category?: GitHistoryRefCategory
  description?: string
  color?: GitHistoryGraphColorId
}

export type GitHistoryItemStatistics = {
  files: number
  insertions: number
  deletions: number
}

export type GitHistoryItem = {
  id: string
  parentIds: string[]
  subject: string
  message: string
  displayId?: string
  author?: string
  authorEmail?: string
  /** Epoch milliseconds (git %at seconds × 1000). */
  timestamp?: number
  statistics?: GitHistoryItemStatistics
  references?: GitHistoryItemRef[]
}

/** Which refs the graph walks: only the workspace HEAD, or every ref in the repo. */
export type GitHistoryScope = 'branch' | 'all'

export const GIT_HISTORY_DEFAULT_SCOPE: GitHistoryScope = 'branch'

// Lives here, not in global-settings-types.ts, which is at the max-lines ceiling.
export type SourceControlHistorySettings = {
  /** Commit graph scope: the workspace branch, or every ref. Per-user; optional for legacy settings. */
  sourceControlHistoryScope?: GitHistoryScope
  /** Whether the Commits section stays open, including across worktree switches. Per-user. */
  sourceControlHistoryExpanded?: boolean
  /** Height in px the user dragged the Commits section to. Per-user. */
  sourceControlHistoryPanelHeight?: number
}

export const GIT_HISTORY_PANEL_MIN_HEIGHT = 96
export const GIT_HISTORY_PANEL_MAX_HEIGHT = 1600
export const GIT_HISTORY_PANEL_DEFAULT_HEIGHT = 256

/** Clamps a persisted panel height, falling back to the default for anything unusable. */
export function normalizeGitHistoryPanelHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return GIT_HISTORY_PANEL_DEFAULT_HEIGHT
  }
  return Math.min(
    Math.max(Math.round(value), GIT_HISTORY_PANEL_MIN_HEIGHT),
    GIT_HISTORY_PANEL_MAX_HEIGHT
  )
}

export function normalizeGitHistoryScope(value: unknown): GitHistoryScope {
  return value === 'all' || value === 'branch' ? value : GIT_HISTORY_DEFAULT_SCOPE
}

export type GitHistoryOptions = {
  limit?: number
  baseRef?: string | null
  scope?: GitHistoryScope
}

export type GitHistoryResult = {
  items: GitHistoryItem[]
  currentRef?: GitHistoryItemRef
  remoteRef?: GitHistoryItemRef
  baseRef?: GitHistoryItemRef
  mergeBase?: string
  /** Draw the synthetic Incoming Changes row standing in for upstream commits the walk omits. Always false in the 'all' scope, where those commits are real rows. */
  hasIncomingChanges: boolean
  /** Draw the synthetic Outgoing Changes row above HEAD. Always false in the 'all' scope. */
  hasOutgoingChanges: boolean
  hasMore: boolean
  limit: number
}

export type GitHistoryExecutor = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr?: string }>
