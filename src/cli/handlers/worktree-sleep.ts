import type {
  RuntimeStatus,
  RuntimeWorktreePsResult,
  RuntimeWorktreePsSummary,
  RuntimeWorktreeRecord
} from '../../shared/runtime-types'
import type {
  JoseWindowOwnersResult,
  JoseWindowWorktreeRef
} from '../../shared/rpc-contract/jose-window-params'
import { normalizeWorkspaceStatuses } from '../../shared/workspace-statuses'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../shared/workspace-scope'
import type { CommandHandler } from '../dispatch'
import { printResult, reportCliError } from '../format'
import { getOptionalStringFlag, getRepeatedStringFlag } from '../flags'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { getRequiredWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
import {
  isWorktreeAsleep,
  planWorktreeSleep,
  resolveWorkspaceStatusQuery,
  selectWorktreesInStatus,
  WORKTREE_SLEEP_REASON_MESSAGES,
  type WorktreeSleepEntry,
  type WorktreeSleepTarget
} from '../worktree-sleep-plan'

export type WorktreeSleepResult = {
  dryRun: boolean
  workspaceStatus?: { id: string; label: string }
  worktrees: WorktreeSleepEntry[]
}

type SleepTiming = { confirmTimeoutMs: number; pollIntervalMs: number }

/** Large enough that a listing never truncates the rows the sleep state is joined against. */
const WORKTREE_SLEEP_PS_LIMIT = 10_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readWorktreePsRows(
  client: RuntimeClient
): Promise<Map<string, RuntimeWorktreePsSummary>> {
  const response = await client.call<RuntimeWorktreePsResult>('worktree.ps', {
    limit: WORKTREE_SLEEP_PS_LIMIT
  })
  return new Map(response.result.worktrees.map((row) => [row.worktreeId, row]))
}

async function resolveNamedTargets(
  selectors: readonly string[],
  cwd: string,
  client: RuntimeClient
): Promise<WorktreeSleepTarget[]> {
  const targets: WorktreeSleepTarget[] = []
  for (const value of selectors) {
    // Why: the folder: grammar is only a workspace key; worktree.show resolves git worktrees.
    if (value.startsWith('folder:')) {
      targets.push({ selectedBy: 'worktree', worktreeId: value, selector: value })
      continue
    }
    try {
      // Same selector rules as `worktree show` and `worktree rm`, one value at a time.
      const selector = await getRequiredWorktreeSelector(
        new Map([['worktree', value]]),
        'worktree',
        cwd,
        client
      )
      const shown = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
        worktree: selector
      })
      targets.push({
        selectedBy: 'worktree',
        worktreeId: shown.result.worktree.id,
        selector: value,
        // Why: worktree.ps drops a workspace being removed for clients that never asked for the marker.
        ...(shown.result.worktree.removing ? { removing: true } : {})
      })
    } catch (error) {
      targets.push({ selectedBy: 'worktree', selector: value, failure: errorMessage(error) })
    }
  }
  return targets
}

async function readStatusDefinitions(client: RuntimeClient) {
  const response = await client.call<{ ui: { workspaceStatuses?: unknown } }>('ui.get')
  return normalizeWorkspaceStatuses(response.result.ui.workspaceStatuses)
}

async function readOtherWindowOwners(client: RuntimeClient): Promise<JoseWindowWorktreeRef[]> {
  try {
    const response = await client.call<JoseWindowOwnersResult>('joseWindow.owners')
    return response.result.owners.filter((owner) => owner.window === 'other')
  } catch (error) {
    // Why: a host without the fork's window ownership has one window, so no other window owns anything.
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      return []
    }
    throw error
  }
}

async function resolveCallerWorktreeIds(cwd: string, client: RuntimeClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const value of [process.env.ORCA_WORKTREE_ID, process.env.ORCA_WORKSPACE_ID]) {
    if (value) {
      ids.add(normalizeWorkspaceSessionKeyToWorkspaceId(value))
    }
  }
  // Why local only: a cwd names a checkout on this machine, not on a paired remote host.
  if (!client.isRemote) {
    try {
      ids.add((await resolveCurrentWorktreeSelector(cwd, client)).slice('id:'.length))
    } catch {
      // Not inside an Orca-managed worktree.
    }
  }
  return ids
}

async function assertSleepHasAWindow(client: RuntimeClient): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (status.result.graphStatus === 'unavailable') {
    throw new RuntimeClientError(
      'worktree_sleep_unavailable',
      'Sleep runs in the Orca window on this host, and none is open (a headless orca serve host, or the window was closed). Open Orca there and try again.'
    )
  }
}

async function sleepAndConfirm(
  entry: WorktreeSleepEntry & { worktreeId: string },
  client: RuntimeClient,
  timing: SleepTiming
): Promise<WorktreeSleepEntry> {
  try {
    await client.call('worktree.sleep', { worktree: `id:${entry.worktreeId}` })
  } catch (error) {
    return { ...entry, outcome: 'failed', reason: 'sleep-failed', message: errorMessage(error) }
  }
  // Why poll: the host only hands the sleep to its window, which tears down tabs before PTYs.
  const deadline = Date.now() + timing.confirmTimeoutMs
  for (;;) {
    const row = (await readWorktreePsRows(client)).get(entry.worktreeId)
    if (!row) {
      return {
        ...entry,
        outcome: 'failed',
        reason: 'not-listed',
        message: WORKTREE_SLEEP_REASON_MESSAGES['not-listed']
      }
    }
    if (isWorktreeAsleep(row)) {
      return { ...entry, outcome: 'slept' }
    }
    if (Date.now() >= deadline) {
      return {
        ...entry,
        outcome: 'failed',
        reason: 'still-awake',
        message: WORKTREE_SLEEP_REASON_MESSAGES['still-awake']
      }
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollIntervalMs))
  }
}

function formatOutcome(entry: WorktreeSleepEntry): string {
  switch (entry.outcome) {
    case 'slept':
      return 'slept'
    case 'would-sleep':
      return 'would sleep'
    case 'skipped':
      return `skipped (${entry.reason ?? 'unknown'})`
    case 'failed':
      return `failed (${entry.reason ?? 'unknown'})`
  }
}

export function formatWorktreeSleepResult(result: WorktreeSleepResult): string {
  const lines = result.worktrees.map((entry) => {
    const name = entry.displayName ?? entry.selector ?? entry.worktreeId ?? 'unknown'
    const target = entry.worktreeId ? `  ${entry.worktreeId}` : ''
    return `${formatOutcome(entry)}: ${name}${target}${entry.message ? `: ${entry.message}` : ''}`
  })
  const scope = result.workspaceStatus
    ? `Workspace status: ${result.workspaceStatus.label} (${result.workspaceStatus.id})`
    : null
  const body = lines.length > 0 ? lines.join('\n') : 'No workspaces matched.'
  const header = [scope, result.dryRun ? 'Dry run: nothing was put to sleep.' : null]
  return [...header.filter((line) => line !== null), body].join('\n')
}

export function createWorktreeSleepHandler(
  timing: SleepTiming = { confirmTimeoutMs: 15_000, pollIntervalMs: 250 }
): CommandHandler {
  return async ({ flags, client, cwd, json }) => {
    const selectors = getRepeatedStringFlag(flags, 'worktree')
    const statusQuery = getOptionalStringFlag(flags, 'workspace-status')
    const dryRun = flags.get('dry-run') === true
    if (selectors.length === 0 && !statusQuery) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name what to sleep: --worktree <selector> (repeatable) or --workspace-status <id-or-label>.'
      )
    }
    const statuses = statusQuery ? await readStatusDefinitions(client) : []
    const status = statusQuery ? resolveWorkspaceStatusQuery(statusQuery, statuses) : null
    const targets = await resolveNamedTargets(selectors, cwd, client)
    const rowsById = await readWorktreePsRows(client)
    if (status) {
      for (const row of selectWorktreesInStatus(rowsById.values(), status, statuses)) {
        targets.push({ selectedBy: 'workspace-status', worktreeId: row.worktreeId })
      }
    }
    const plan = planWorktreeSleep({
      targets,
      rowsById,
      callerWorktreeIds: await resolveCallerWorktreeIds(cwd, client),
      otherWindowOwners: await readOtherWindowOwners(client)
    })
    if (!dryRun && plan.some((entry) => entry.outcome === 'would-sleep')) {
      await assertSleepHasAWindow(client)
    }
    const worktrees: WorktreeSleepEntry[] = []
    for (const entry of plan) {
      // Why one at a time: the sidebar's multi-select sleep runs its workspaces in sequence too.
      worktrees.push(
        dryRun || entry.outcome !== 'would-sleep' || entry.worktreeId === null
          ? entry
          : await sleepAndConfirm({ ...entry, worktreeId: entry.worktreeId }, client, timing)
      )
    }
    const result: WorktreeSleepResult = {
      dryRun,
      ...(status ? { workspaceStatus: { id: status.id, label: status.label } } : {}),
      worktrees
    }
    const failed = worktrees.filter((entry) => entry.outcome === 'failed')
    if (failed.length === 0) {
      printResult({ id: 'local', ok: true, result, _meta: { runtimeId: 'client' } }, json, () =>
        formatWorktreeSleepResult(result)
      )
      return
    }
    // Why the failure envelope: a JSON caller checking `ok` must not read a partial sleep as done.
    if (json) {
      reportCliError(
        new RuntimeClientError(
          'worktree_sleep_incomplete',
          `${failed.length} of ${worktrees.length} workspaces were not put to sleep.`,
          result
        ),
        true
      )
    } else {
      console.log(formatWorktreeSleepResult(result))
    }
    process.exitCode = 1
  }
}

export const worktreeSleepHandler = createWorktreeSleepHandler()
