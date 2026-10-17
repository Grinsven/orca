import type { RuntimeWorktreePsSummary } from '../shared/runtime-types'
import type { WorkspaceStatusDefinition } from '../shared/worktree/types'
import type { JoseWindowWorktreeRef } from '../shared/rpc-contract/jose-window-params'
import { getWorkspaceStatus } from '../shared/workspace-statuses'
import { parseExecutionHostId } from '../shared/execution-host'
import { parseWorkspaceKey } from '../shared/workspace-scope'
import { RuntimeClientError } from './runtime-client'

export type WorktreeSleepSelectedBy = 'worktree' | 'workspace-status'

export type WorktreeSleepReason =
  | 'already-asleep'
  | 'caller-worktree'
  | 'on-screen'
  | 'open-in-another-window'
  | 'folder-workspace'
  | 'removing'
  | 'not-listed'
  | 'selector-failed'
  | 'sleep-failed'
  | 'still-awake'

export type WorktreeSleepEntry = {
  worktreeId: string | null
  displayName: string | null
  path: string | null
  selectedBy: WorktreeSleepSelectedBy
  /** The --worktree value, for rows named on the command line. */
  selector?: string
  outcome: 'slept' | 'would-sleep' | 'skipped' | 'failed'
  reason?: WorktreeSleepReason
  message?: string
}

export type WorktreeSleepTarget =
  | {
      selectedBy: WorktreeSleepSelectedBy
      worktreeId: string
      selector?: string
      removing?: boolean
    }
  | { selectedBy: 'worktree'; selector: string; failure: string }

export const WORKTREE_SLEEP_REASON_MESSAGES: Record<
  Exclude<WorktreeSleepReason, 'selector-failed' | 'sleep-failed'>,
  string
> = {
  'already-asleep': 'Already asleep: no live terminal, browser tab or agent.',
  'caller-worktree': 'This command runs in this workspace, so it is never put to sleep from here.',
  'on-screen': 'Open on screen in the Orca window; name it with --worktree to sleep it anyway.',
  'open-in-another-window':
    'Open in another Orca window, whose terminals a sleep from here cannot reach. Sleep it from that window.',
  'folder-workspace':
    'Folder workspaces cannot be put to sleep from the CLI yet; use Sleep in the sidebar.',
  removing: 'Orca is removing this workspace.',
  'not-listed':
    'Orca does not report activity for this workspace (it may be being removed), so a sleep cannot be confirmed.',
  'still-awake':
    'Orca did not confirm the sleep in time; the workspace still has a live terminal, browser tab or agent.'
}

/** Asleep exactly when the sidebar shows the moon; the host computes that as `hasHostSidebarActivity`. */
export function isWorktreeAsleep(row: Pick<RuntimeWorktreePsSummary, 'hasHostSidebarActivity'>) {
  return row.hasHostSidebarActivity === false
}

/** Exact id first, then the board label, so `completed` and `Done` both name the default column. */
export function resolveWorkspaceStatusQuery(
  query: string,
  statuses: readonly WorkspaceStatusDefinition[]
): WorkspaceStatusDefinition {
  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()
  const byId = statuses.find((status) => status.id === trimmed)
  if (byId) {
    return byId
  }
  const byLabel = statuses.filter((status) => status.label.toLowerCase() === lower)
  const listed = statuses.map((status) => `${status.id} (${status.label})`).join(', ')
  if (byLabel.length > 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `"${query}" is the label of several workspace statuses; pass the id instead: ${listed}.`
    )
  }
  const match = byLabel[0] ?? statuses.find((status) => status.id.toLowerCase() === lower)
  if (!match) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No workspace status matches "${query}". Board statuses: ${listed}.`
    )
  }
  return match
}

/** The rows the board shows in that column: unknown stored ids fall into the default column. */
export function selectWorktreesInStatus(
  rows: Iterable<RuntimeWorktreePsSummary>,
  status: WorkspaceStatusDefinition,
  statuses: readonly WorkspaceStatusDefinition[]
): RuntimeWorktreePsSummary[] {
  return [...rows].filter(
    (row) =>
      !row.isArchived &&
      getWorkspaceStatus({ workspaceStatus: row.workspaceStatus }, statuses) === status.id
  )
}

function sameHost(left: string | undefined, right: string | undefined): boolean {
  return (
    (parseExecutionHostId(left)?.id ?? 'local') === (parseExecutionHostId(right)?.id ?? 'local')
  )
}

function isFolderWorkspace(worktreeId: string, row: RuntimeWorktreePsSummary | undefined) {
  return (
    row?.workspaceKind === 'folder-workspace' || parseWorkspaceKey(worktreeId)?.type === 'folder'
  )
}

/** Decides every target before anything sleeps; the caller's own workspace is never a candidate. */
export function planWorktreeSleep(args: {
  targets: readonly WorktreeSleepTarget[]
  rowsById: ReadonlyMap<string, RuntimeWorktreePsSummary>
  callerWorktreeIds: ReadonlySet<string>
  otherWindowOwners: readonly JoseWindowWorktreeRef[]
}): WorktreeSleepEntry[] {
  const seen = new Set<string>()
  const entries: WorktreeSleepEntry[] = []
  for (const target of args.targets) {
    if ('failure' in target) {
      entries.push({
        worktreeId: null,
        displayName: null,
        path: null,
        selectedBy: target.selectedBy,
        selector: target.selector,
        outcome: 'skipped',
        reason: 'selector-failed',
        message: target.failure
      })
      continue
    }
    if (seen.has(target.worktreeId)) {
      continue
    }
    seen.add(target.worktreeId)
    const row = args.rowsById.get(target.worktreeId)
    const entry: WorktreeSleepEntry = {
      worktreeId: target.worktreeId,
      displayName: row?.displayName ?? null,
      path: row?.path ?? null,
      selectedBy: target.selectedBy,
      ...(target.selector !== undefined ? { selector: target.selector } : {}),
      outcome: 'would-sleep'
    }
    const skip = (reason: keyof typeof WORKTREE_SLEEP_REASON_MESSAGES) =>
      entries.push({
        ...entry,
        outcome: 'skipped',
        reason,
        message: WORKTREE_SLEEP_REASON_MESSAGES[reason]
      })
    if (args.callerWorktreeIds.has(target.worktreeId)) {
      skip('caller-worktree')
    } else if (isFolderWorkspace(target.worktreeId, row)) {
      skip('folder-workspace')
    } else if (target.removing || row?.removing) {
      skip('removing')
    } else if (!row) {
      skip('not-listed')
    } else if (isWorktreeAsleep(row)) {
      skip('already-asleep')
    } else if (
      args.otherWindowOwners.some(
        (owner) =>
          owner.worktreeId === row.worktreeId && sameHost(owner.executionHostId, row.hostId)
      )
    ) {
      skip('open-in-another-window')
    } else if (target.selectedBy === 'workspace-status' && row.isActive) {
      skip('on-screen')
    } else {
      entries.push(entry)
    }
  }
  return entries
}
