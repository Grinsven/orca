import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreePsSummary } from '../../shared/runtime-types'
import { RuntimeClientError } from '../runtime-client'
import { psRow } from '../worktree-sleep-test-fixtures'
import { createWorktreeSleepHandler } from './worktree-sleep'

const CWD = '/work/r::me'

function envelope(result: unknown) {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

/** A fake host whose sleep clears a workspace's activity after `sleepTakesPolls` ps reads. */
function fakeHost(
  rows: RuntimeWorktreePsSummary[],
  options: {
    owners?: { worktreeId: string; executionHostId: string; window: 'main' | 'other' }[]
    sleepFails?: string
    neverSleeps?: boolean
    graphStatus?: 'ready' | 'unavailable'
  } = {}
) {
  const byId = new Map(rows.map((row) => [row.worktreeId, { ...row }]))
  const call = vi.fn(async (method: string, params?: { worktree?: string }) => {
    switch (method) {
      case 'worktree.list':
        return envelope({
          worktrees: [...byId.values()].map((row) => ({
            id: row.worktreeId,
            repoId: row.repoId,
            path: row.path
          }))
        })
      case 'worktree.show': {
        const row = byId.get(String(params?.worktree).replace(/^id:/, ''))
        if (!row) {
          throw new RuntimeClientError('selector_not_found', 'No worktree matches the selector')
        }
        return envelope({ worktree: { id: row.worktreeId } })
      }
      case 'worktree.ps':
        return envelope({ worktrees: [...byId.values()], totalCount: byId.size, truncated: false })
      case 'ui.get':
        return envelope({ ui: {} })
      case 'joseWindow.owners':
        if (!options.owners) {
          throw new RuntimeClientError('method_not_found', 'Unknown method')
        }
        return envelope({ owners: options.owners })
      case 'status.get':
        return envelope({ graphStatus: options.graphStatus ?? 'ready' })
      case 'worktree.sleep': {
        if (options.sleepFails) {
          throw new RuntimeClientError('runtime_error', options.sleepFails)
        }
        const id = String(params?.worktree).replace(/^id:/, '')
        const row = byId.get(id)
        if (row && !options.neverSleeps) {
          byId.set(id, { ...row, hasHostSidebarActivity: false, liveTerminalCount: 0 })
        }
        return envelope({ worktreeId: id })
      }
      default:
        throw new Error(`unexpected ${method}`)
    }
  })
  return call
}

async function run(
  call: ReturnType<typeof fakeHost>,
  flags: [string, string | boolean][],
  json = false
) {
  const handler = createWorktreeSleepHandler({ confirmTimeoutMs: 20, pollIntervalMs: 1 })
  await handler({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only uses call and isRemote.
    client: { call, isRemote: false } as never,
    cwd: CWD,
    flags: new Map(flags),
    json
  })
}

function sleptIds(call: ReturnType<typeof fakeHost>): string[] {
  return call.mock.calls
    .filter(([method]) => method === 'worktree.sleep')
    .map(([, params]) => String(params?.worktree))
}

let output: string[] = []

beforeEach(() => {
  output = []
  vi.stubEnv('ORCA_WORKTREE_ID', '')
  vi.stubEnv('ORCA_WORKSPACE_ID', '')
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line))
  })
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    output.push(String(line))
  })
  process.exitCode = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('orca worktree sleep', () => {
  it('sleeps each named workspace, waits for the host to confirm, and prints one line each', async () => {
    const call = fakeHost([psRow('r::a'), psRow('r::b'), psRow('r::me')])
    await run(call, [['worktree', 'id:r::a\u0000id:r::b']])
    expect(sleptIds(call)).toEqual(['id:r::a', 'id:r::b'])
    expect(output.join('\n').split('\n')).toEqual(['slept: r::a  r::a', 'slept: r::b  r::b'])
    expect(process.exitCode).toBeUndefined()
  })

  it('skips the workspace of the terminal running the command, from env or cwd', async () => {
    vi.stubEnv('ORCA_WORKTREE_ID', 'r::env')
    const call = fakeHost([psRow('r::env'), psRow('r::me')])
    await run(call, [['worktree', 'id:r::env\u0000id:r::me']])
    expect(sleptIds(call)).toEqual([])
    expect(output.join('\n')).toContain('skipped (caller-worktree): r::env')
    expect(output.join('\n')).toContain('skipped (caller-worktree): r::me')
  })

  it('sleeps every workspace in a status column, skipping the ones it must not touch', async () => {
    const call = fakeHost(
      [
        psRow('r::done', { workspaceStatus: 'completed' }),
        psRow('r::asleep', { workspaceStatus: 'completed', hasHostSidebarActivity: false }),
        psRow('r::window-2', { workspaceStatus: 'completed' }),
        psRow('r::shown', { workspaceStatus: 'completed', isActive: true }),
        psRow('r::busy', { workspaceStatus: 'in-progress' }),
        psRow('r::me', { workspaceStatus: 'completed' })
      ],
      { owners: [{ worktreeId: 'r::window-2', executionHostId: 'local', window: 'other' }] }
    )
    await run(call, [['workspace-status', 'completed']], true)
    expect(sleptIds(call)).toEqual(['id:r::done'])
    const printed = JSON.parse(output.join('\n'))
    expect(printed.result.workspaceStatus.id).toBe('completed')
    expect(
      printed.result.worktrees.map(
        (entry: { worktreeId: string; outcome: string; reason?: string }) => [
          entry.worktreeId,
          entry.outcome,
          entry.reason
        ]
      )
    ).toEqual([
      ['r::done', 'slept', undefined],
      ['r::asleep', 'skipped', 'already-asleep'],
      ['r::window-2', 'skipped', 'open-in-another-window'],
      ['r::shown', 'skipped', 'on-screen'],
      ['r::me', 'skipped', 'caller-worktree']
    ])
  })

  it('changes nothing on a dry run and says what would sleep', async () => {
    const call = fakeHost([psRow('r::done', { workspaceStatus: 'completed' }), psRow('r::me')])
    await run(call, [
      ['workspace-status', 'completed'],
      ['dry-run', true]
    ])
    expect(sleptIds(call)).toEqual([])
    expect(call.mock.calls.some(([method]) => method === 'status.get')).toBe(false)
    expect(output.join('\n')).toContain('Dry run: nothing was put to sleep.')
    expect(output.join('\n')).toContain('would sleep: r::done')
  })

  it('reports a selector that does not resolve as skipped and sleeps the rest', async () => {
    const call = fakeHost([psRow('r::a'), psRow('r::me')])
    await run(call, [['worktree', 'id:r::missing\u0000id:r::a']])
    expect(sleptIds(call)).toEqual(['id:r::a'])
    expect(output.join('\n')).toContain('skipped (selector-failed): id:r::missing')
  })

  it('fails with the host message, and exits non-zero, when a sleep is refused or never lands', async () => {
    const refused = fakeHost([psRow('r::a'), psRow('r::me')], { sleepFails: 'renderer gone' })
    await run(refused, [['worktree', 'id:r::a']])
    expect(output.join('\n')).toContain('failed (sleep-failed): r::a  r::a: renderer gone')
    expect(process.exitCode).toBe(1)

    output = []
    process.exitCode = undefined
    const stuck = fakeHost([psRow('r::a'), psRow('r::me')], { neverSleeps: true })
    await run(stuck, [['worktree', 'id:r::a']], true)
    const printed = JSON.parse(output.join('\n'))
    expect(printed.ok).toBe(false)
    expect(printed.error.code).toBe('worktree_sleep_incomplete')
    expect(process.exitCode).toBe(1)
  })

  it('refuses before sleeping anything when the host has no window to run the sleep', async () => {
    const call = fakeHost([psRow('r::a'), psRow('r::me')], { graphStatus: 'unavailable' })
    await expect(run(call, [['worktree', 'id:r::a']])).rejects.toMatchObject({
      code: 'worktree_sleep_unavailable'
    })
    expect(sleptIds(call)).toEqual([])
  })

  it('asks for a target when given neither flag', async () => {
    await expect(run(fakeHost([]), [])).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
