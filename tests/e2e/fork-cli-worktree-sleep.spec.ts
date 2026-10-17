/**
 * `orca worktree sleep` from the compiled CLI against one isolated Orca app: a workspace with a live
 * terminal goes to sleep (its PTY ends, the host reports no sidebar activity), and a second run skips
 * it as already asleep.
 *
 * Run:
 *   npx playwright test tests/e2e/fork-cli-worktree-sleep.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --workers=1
 */
import { expect, test } from './helpers/orca-app'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import {
  ensureTerminalVisible,
  getWorktreeTabs,
  switchToOtherWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActivePanePtyId } from './helpers/terminal'
import type {
  RuntimeTerminalListResult,
  RuntimeWorktreePsResult
} from '../../src/shared/runtime-types'
import type { WorktreeSleepResult } from '../../src/cli/handlers/worktree-sleep'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('orca worktree sleep ends a workspace terminal and reports it asleep', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  const target = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const ptyId = await waitForActivePanePtyId(orcaPage)
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))

  const awake = async () =>
    (await orcaCliResult<RuntimeWorktreePsResult>(userData, ['worktree', 'ps'])).worktrees.find(
      (row) => row.worktreeId === target
    )?.hasHostSidebarActivity
  await expect.poll(awake, { timeout: 60_000 }).toBe(true)
  // Why: the realistic case is sleeping finished work from elsewhere, not the workspace on screen.
  expect(await switchToOtherWorktree(orcaPage, target)).not.toBeNull()

  const slept = await orcaCliResult<WorktreeSleepResult>(userData, [
    'worktree',
    'sleep',
    '--worktree',
    `id:${target}`
  ])
  expect(slept.worktrees).toMatchObject([{ worktreeId: target, outcome: 'slept' }])

  expect(await awake()).toBe(false)
  const terminals = await orcaCliResult<RuntimeTerminalListResult>(userData, [
    'terminal',
    'list',
    '--worktree',
    `id:${target}`
  ])
  expect(terminals.terminals.map((terminal) => terminal.ptyId)).not.toContain(ptyId)
  // Why: sleep keeps the tab so the workspace resumes; only its process ends.
  expect((await getWorktreeTabs(orcaPage, target)).length).toBeGreaterThan(0)

  const again = await orcaCliResult<WorktreeSleepResult>(userData, [
    'worktree',
    'sleep',
    '--worktree',
    `id:${target}`
  ])
  expect(again.worktrees).toMatchObject([
    { worktreeId: target, outcome: 'skipped', reason: 'already-asleep' }
  ])

  const file = testInfo.outputPath('after-sleep.png')
  await orcaPage.screenshot({ path: file })
  await testInfo.attach('after-sleep', { path: file, contentType: 'image/png' })
})
