import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_STATUSES,
  getDefaultWorkspaceStatusId
} from '../shared/workspace-statuses'
import type { RuntimeWorktreePsSummary } from '../shared/runtime-types'
import {
  planWorktreeSleep,
  resolveWorkspaceStatusQuery,
  selectWorktreesInStatus,
  type WorktreeSleepTarget
} from './worktree-sleep-plan'
import { psRow } from './worktree-sleep-test-fixtures'

function plan(
  targets: WorktreeSleepTarget[],
  rows: RuntimeWorktreePsSummary[],
  options: {
    caller?: string[]
    otherWindow?: { worktreeId: string; executionHostId: string }[]
  } = {}
) {
  return planWorktreeSleep({
    targets,
    rowsById: new Map(rows.map((row) => [row.worktreeId, row])),
    callerWorktreeIds: new Set(options.caller ?? []),
    otherWindowOwners: options.otherWindow ?? []
  })
}

const named = (worktreeId: string): WorktreeSleepTarget => ({
  selectedBy: 'worktree',
  worktreeId,
  selector: `id:${worktreeId}`
})
const byStatus = (worktreeId: string): WorktreeSleepTarget => ({
  selectedBy: 'workspace-status',
  worktreeId
})
const outcomes = (entries: ReturnType<typeof plan>) =>
  entries.map((entry) => [entry.worktreeId ?? entry.selector, entry.outcome, entry.reason])

describe('planWorktreeSleep', () => {
  it('plans a named awake workspace, once even when named twice', () => {
    expect(outcomes(plan([named('r::a'), named('r::a')], [psRow('r::a')]))).toEqual([
      ['r::a', 'would-sleep', undefined]
    ])
  })

  it('never plans the caller workspace, named or picked by status', () => {
    const rows = [psRow('r::me'), psRow('r::other')]
    expect(
      outcomes(
        plan([named('r::me'), byStatus('r::other')], rows, { caller: ['r::me', 'r::other'] })
      )
    ).toEqual([
      ['r::me', 'skipped', 'caller-worktree'],
      ['r::other', 'skipped', 'caller-worktree']
    ])
  })

  it('skips each workspace it cannot or should not sleep, with the reason', () => {
    const rows = [
      psRow('r::asleep', { hasHostSidebarActivity: false }),
      psRow('folder:f1', { workspaceKind: 'folder-workspace' }),
      psRow('r::removing', { removing: true }),
      psRow('r::window-2'),
      psRow('r::shown', { isActive: true })
    ]
    const targets: WorktreeSleepTarget[] = [
      named('r::asleep'),
      named('folder:f1'),
      named('r::removing'),
      { selectedBy: 'worktree', worktreeId: 'r::removed-from-ps', selector: 'x', removing: true },
      named('r::gone'),
      named('r::window-2'),
      byStatus('r::shown'),
      { selectedBy: 'worktree', selector: 'name:typo', failure: 'selector_not_found' }
    ]
    const entries = plan(targets, rows, {
      otherWindow: [{ worktreeId: 'r::window-2', executionHostId: 'local' }]
    })
    expect(outcomes(entries)).toEqual([
      ['r::asleep', 'skipped', 'already-asleep'],
      ['folder:f1', 'skipped', 'folder-workspace'],
      ['r::removing', 'skipped', 'removing'],
      ['r::removed-from-ps', 'skipped', 'removing'],
      ['r::gone', 'skipped', 'not-listed'],
      ['r::window-2', 'skipped', 'open-in-another-window'],
      ['r::shown', 'skipped', 'on-screen'],
      ['name:typo', 'skipped', 'selector-failed']
    ])
    expect(entries.at(-1)?.message).toBe('selector_not_found')
    expect(entries.every((entry) => typeof entry.message === 'string')).toBe(true)
  })

  it('sleeps the on-screen workspace when it is named', () => {
    expect(outcomes(plan([named('r::a')], [psRow('r::a', { isActive: true })]))).toEqual([
      ['r::a', 'would-sleep', undefined]
    ])
  })

  it('matches another window only on the same execution host', () => {
    const rows = [psRow('r::a', { hostId: 'ssh:box' })]
    const otherHost = plan([named('r::a')], rows, {
      otherWindow: [{ worktreeId: 'r::a', executionHostId: 'local' }]
    })
    const sameHost = plan([named('r::a')], rows, {
      otherWindow: [{ worktreeId: 'r::a', executionHostId: 'ssh:box' }]
    })
    expect([otherHost[0]?.outcome, sameHost[0]?.reason]).toEqual([
      'would-sleep',
      'open-in-another-window'
    ])
  })
})

describe('workspace status selection', () => {
  it('resolves an id, then a label, and refuses an unknown status', () => {
    expect(resolveWorkspaceStatusQuery('completed', DEFAULT_WORKSPACE_STATUSES).id).toBe(
      'completed'
    )
    const label = DEFAULT_WORKSPACE_STATUSES.find((status) => status.id === 'completed')?.label
    expect(
      resolveWorkspaceStatusQuery(String(label).toUpperCase(), DEFAULT_WORKSPACE_STATUSES).id
    ).toBe('completed')
    expect(() => resolveWorkspaceStatusQuery('nope', DEFAULT_WORKSPACE_STATUSES)).toThrow(
      /No workspace status matches/
    )
  })

  it('selects the unarchived rows in the column, unknown ids in the default column', () => {
    const completed = resolveWorkspaceStatusQuery('completed', DEFAULT_WORKSPACE_STATUSES)
    const rows = [
      psRow('r::done', { workspaceStatus: 'completed' }),
      psRow('r::archived', { workspaceStatus: 'completed', isArchived: true }),
      psRow('r::busy', { workspaceStatus: 'in-progress' })
    ]
    expect(
      selectWorktreesInStatus(rows, completed, DEFAULT_WORKSPACE_STATUSES).map(
        (row) => row.worktreeId
      )
    ).toEqual(['r::done'])
    const fallback = resolveWorkspaceStatusQuery(
      getDefaultWorkspaceStatusId(DEFAULT_WORKSPACE_STATUSES),
      DEFAULT_WORKSPACE_STATUSES
    )
    expect(
      selectWorktreesInStatus(
        [psRow('r::odd', { workspaceStatus: 'retired-column' })],
        fallback,
        DEFAULT_WORKSPACE_STATUSES
      ).map((row) => row.worktreeId)
    ).toEqual(['r::odd'])
  })
})
