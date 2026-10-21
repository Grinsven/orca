import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  openGoldenSourceControl
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { seedChangesViewFixture } from './jose-changes-view-fixture'

const SHOTS_DIR = process.env.JOSE_CHANGES_VIEW_SHOTS_DIR

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS_DIR) {
    return
  }
  await mkdir(SHOTS_DIR, { recursive: true })
  // Shiki tokens arrive from the worker pool a moment after the rows paint.
  await page.waitForTimeout(800)
  const cdp = await page.context().newCDPSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await cdp.detach()
  await writeFile(path.join(SHOTS_DIR, `${name}.png`), Buffer.from(data, 'base64'))
}

function percentile(sorted: number[], fraction: number): number {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

/** Scrolls the diff by a fixed step every animation frame and records frame intervals and long tasks. */
async function measureScroll(page: Page, stepPx: number, maxFrames: number) {
  return page.evaluate(
    async ({ stepPx, maxFrames }) => {
      const scroller = document.querySelector<HTMLElement>('[data-changes-view] .scrollbar-editor')
      if (!scroller) {
        throw new Error('Changes view scroller missing')
      }
      scroller.scrollTop = 0
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const longTasks: number[] = []
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(entry.duration)
        }
      })
      observer.observe({ type: 'longtask' })
      const intervals: number[] = []
      let frames = 0
      await new Promise<void>((resolve) => {
        let last = performance.now()
        const tick = (now: number): void => {
          intervals.push(now - last)
          last = now
          const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
          if (frames++ >= maxFrames || atEnd) {
            resolve()
            return
          }
          scroller.scrollTop += stepPx
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      observer.disconnect()
      return {
        intervals: intervals.slice(1),
        longTasks,
        scrolledPx: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        visibility: document.visibilityState
      }
    },
    { stepPx, maxFrames }
  )
}

test('changes view renders View all with Pierre, scopes, layouts and smooth scrolling', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'changes-view')
  const baseBranch = `${fixture.branchName}-base`
  registerPostElectronShutdownCleanup(async () => {
    cleanupGoldenWorktree(testRepoPath, fixture)
    execFileSync('git', ['branch', '-D', baseBranch], { cwd: testRepoPath, stdio: 'pipe' })
  })
  const { branchFiles, uncommittedFiles } = seedChangesViewFixture(fixture.worktreePath, baseBranch)

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await waitForSessionReady(orcaPage)
  const portable = JSON.parse(await readFile('jose-setup/files/orca-settings.json', 'utf8'))
  await orcaPage.evaluate(async ({ terminalCustomThemes, terminalThemeDark }) => {
    await window.__store!.getState().updateSettingsOrThrow({
      theme: 'dark',
      joseUiVariant: 'vscode',
      modernUi: true,
      modernUiTabStyle: 'connected',
      terminalCustomThemes,
      terminalThemeDark,
      diffDefaultView: 'inline',
      diffWordWrap: false,
      diffShowWhitespace: true,
      combinedDiffFileTreeVisibleByDefault: true
    })
    await window.api.ui.set({ uiZoomLevel: 0.5 })
  }, portable.settings)
  // Hidden test windows must keep painting frames for the scroll measurement.
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })

  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(async (baseRef) => {
    const state = window.__store!.getState()
    await state.updateWorktreeMeta(state.activeWorktreeId!, { baseRef })
  }, baseBranch)
  await expect
    .poll(
      () =>
        orcaPage.evaluate(() => {
          const state = window.__store!.getState()
          const summary = state.gitBranchCompareSummaryByWorktree[state.activeWorktreeId!]
          return summary ? `${summary.status}:${summary.baseRef}` : 'none'
        }),
      { timeout: 30_000, message: 'Branch compare against the fixture base never became ready' }
    )
    .toBe(`ready:${baseBranch}`)

  const changes = orcaPage.getByRole('button', { name: /^Changes \d+$/ }).locator('..')
  await changes.getByRole('button', { name: 'View all', exact: true }).click()
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))

  const view = orcaPage.locator('[data-changes-view]')
  const header = view.locator('[data-changes-view-header]')
  // The Changes section's "View all" opens the working tree scope.
  await expect(view).toHaveAttribute('data-changes-view', 'uncommitted')
  await expect(orcaPage.locator('.monaco-diff-editor')).toHaveCount(0)
  await expect(header).toContainText(`${uncommittedFiles.length} files`)
  await expect(view.locator('[data-changes-view-totals="complete"]')).toBeVisible({
    timeout: 30_000
  })
  await expect(view.locator('[data-title]', { hasText: 'src/renamed.ts' })).toBeVisible()
  await shoot(orcaPage, '01-stacked-uncommitted')

  await view.locator('[data-changes-scope-trigger]').click()
  await expect(orcaPage.getByRole('menuitemradio', { name: /^Changes/ })).toBeVisible()
  await shoot(orcaPage, '02-scope-picker-open')
  await orcaPage.getByRole('menuitemradio', { name: /^Changes/ }).click()
  await expect(view).toHaveAttribute('data-changes-view', 'branch')
  await expect(header).toContainText(`${branchFiles.length} files`)
  await expect(view.locator('[data-changes-view-totals="complete"]')).toBeVisible({
    timeout: 60_000
  })
  await expect(view.locator('[data-diffs-header]').first()).toBeVisible()
  await expect(view.locator('[data-separator^="line-info"]').first()).toContainText(/unmodified/)
  await shoot(orcaPage, '03-stacked-changes')

  // The tree jumps to a file and the diff shows its sticky header.
  await view.getByRole('button', { name: /^committed-only\.ts/ }).click()
  await expect(view.locator('[data-title]', { hasText: 'src/committed-only.ts' })).toBeVisible()
  await shoot(orcaPage, '04-tree-reveal')

  await view.getByRole('radio', { name: 'Split diff view' }).click()
  await expect(view.locator('[data-diff-type="split"]').first()).toBeVisible()
  await shoot(orcaPage, '05-split-changes')
  await view.getByRole('button', { name: 'Enable line wrapping' }).click()
  await expect(view.locator('[data-overflow="wrap"]').first()).toBeVisible()
  await view.getByRole('button', { name: 'Disable line wrapping' }).click()
  await view.getByRole('radio', { name: 'Stacked diff view' }).click()
  await expect(view.locator('[data-diff-type="single"]').first()).toBeVisible()

  // Large diff: scroll the whole branch view and record frame pacing.
  const scroll = await measureScroll(orcaPage, 60, 900)
  await shoot(orcaPage, '06-large-diff-scrolled')
  const sorted = [...scroll.intervals].sort((a, b) => a - b)
  const report = {
    frames: sorted.length,
    p50Ms: Math.round(percentile(sorted, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 0.95) * 100) / 100,
    maxMs: Math.round((sorted.at(-1) ?? 0) * 100) / 100,
    longTasks: scroll.longTasks.length,
    longestTaskMs: Math.round(Math.max(0, ...scroll.longTasks)),
    scrolledPx: scroll.scrolledPx,
    scrollHeight: scroll.scrollHeight,
    visibility: scroll.visibility
  }
  console.log(`changes-view scroll: ${JSON.stringify(report)}`)
  if (SHOTS_DIR) {
    await writeFile(path.join(SHOTS_DIR, 'scroll-report.json'), JSON.stringify(report, null, 2))
  }
  expect(report.frames).toBeGreaterThan(100)

  await view.locator('[data-changes-scope-trigger]').click()
  await orcaPage.getByRole('menuitemradio', { name: /Uncommitted/ }).click()
  await expect(view).toHaveAttribute('data-changes-view', 'uncommitted')
  await expect(view.getByRole('button', { name: /^committed-only\.ts/ })).toHaveCount(0)
  await view.getByRole('radio', { name: 'Split diff view' }).click()
  await expect(view.locator('[data-diff-type="split"]').first()).toBeVisible()
  await shoot(orcaPage, '07-split-uncommitted')

  await orcaPage.setViewportSize({ width: 900, height: 900 })
  await expect(header).toBeVisible()
  await shoot(orcaPage, '08-header-900')
})
