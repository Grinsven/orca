import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { test, expect } from './helpers/source-control-generation-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('SCM badge matches VS Code for mixed Git changes and Jose display settings', async ({
  orcaPage,
  electronApp
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const portable = JSON.parse(await readFile('jose-setup/files/orca-settings.json', 'utf8'))
  await orcaPage.evaluate(async ({ terminalCustomThemes, terminalThemeDark }) => {
    await window.__store!.getState().updateSettingsOrThrow({
      theme: 'dark',
      joseUiVariant: 'vscode',
      modernUi: true,
      modernUiTabStyle: 'connected',
      terminalCustomThemes,
      terminalThemeDark
    })
    await window.api.ui.set({ uiZoomLevel: 0.5 })
  }, portable.settings)
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return state.getKnownWorktreeById(state.activeWorktreeId!)!.path
  })
  async function git(...args: string[]): Promise<string> {
    const result = await runProcess({ program: 'git', args, cwd: worktreePath })
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout)
    }
    return result.stdout
  }
  await git('checkout', '-b', 'badge-conflict')
  await writeFile(path.join(worktreePath, 'README.md'), 'other side\n')
  await git('add', 'README.md')
  await git('commit', '-m', 'fixture: other side')
  await git('checkout', '-')
  await writeFile(path.join(worktreePath, 'README.md'), 'our side\n')
  await git('add', 'README.md')
  await git('commit', '-m', 'fixture: our side')
  await git('merge', 'badge-conflict').catch(() => undefined)
  await writeFile(path.join(worktreePath, 'src/index.ts'), 'export const staged = true\n')
  await writeFile(path.join(worktreePath, 'package.json'), '{"name":"badge-fixture"}\n')
  await git('add', 'src/index.ts', 'package.json')
  await writeFile(path.join(worktreePath, 'src/index.ts'), 'export const unstaged = true\n')
  await writeFile(
    path.join(worktreePath, 'src/diff-note-layout.ts'),
    'export const change = true\n'
  )
  await writeFile(path.join(worktreePath, 'new.txt'), 'untracked\n')
  const porcelain = await git('status', '--porcelain=v1', '--untracked-files=all')
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setActivityBarPosition('top')
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('source-control')
  })
  const sidebar = orcaPage.locator('[data-orca-region="right-sidebar"]')
  for (const [filePath, area] of [
    ['src/index.ts', 'staged'],
    ['src/index.ts', 'unstaged'],
    ['new.txt', 'untracked']
  ]) {
    await sidebar
      .locator(`[data-source-control-path="${filePath}"][data-source-control-area="${area}"]`)
      .waitFor({ timeout: 20_000 })
  }
  await orcaPage.mouse.move(0, 0)
  const cdp = await orcaPage.context().newCDPSession(orcaPage)
  const screenshotDirectory = process.env.JOSE_SIDEBAR_SCREENSHOT_DIR
  const observations = []
  for (const layout of ['top', 'side'] as const) {
    await orcaPage.evaluate((position) => {
      window.__store!.getState().setActivityBarPosition(position)
    }, layout)
    const button = sidebar.locator('[data-sidebar-activity="source-control"]')
    await button.waitFor()
    const observation = await button.evaluate((element) => {
      const badge = element.querySelector('[data-sidebar-change-count]')!
      const style = getComputedStyle(badge)
      const badgeBox = badge.getBoundingClientRect()
      const buttonBox = element.getBoundingClientRect()
      const iconBox = element.querySelector('svg')!.getBoundingClientRect()
      return {
        count: badge.textContent,
        description: element.getAttribute('aria-description'),
        height: Math.round(Number.parseFloat(style.height) * 100) / 100,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        background: style.backgroundColor,
        foreground: style.color,
        borderWidth: style.borderWidth,
        centeredBelowIcon: Math.abs(badgeBox.top - (iconBox.top + iconBox.height / 2)) < 1,
        insideButton: badgeBox.right <= buttonBox.right && badgeBox.bottom <= buttonBox.bottom
      }
    })
    observations.push({ layout, ...observation })
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true })
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(
        path.join(screenshotDirectory, `badge-${layout}.png`),
        Buffer.from(data, 'base64')
      )
    }
  }
  await cdp.detach()
  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      zoom: window.webContents.getZoomLevel()
    }))
  )
  if (screenshotDirectory) {
    await writeFile(
      path.join(screenshotDirectory, 'observations.json'),
      JSON.stringify({ porcelain, windows, observations }, null, 2)
    )
  }
  expect({ porcelain: porcelain.trim().split('\n').sort(), windows, observations }).toEqual({
    porcelain: [
      ' M src/diff-note-layout.ts',
      'M  package.json',
      'MM src/index.ts',
      'UU README.md',
      '?? new.txt'
    ].sort(),
    windows: [{ visible: false, zoom: 0.5 }],
    observations: ['top', 'side'].map((layout) => ({
      layout,
      count: '6',
      description: '6 wijzigingen',
      height: 16,
      fontSize: '9px',
      fontWeight: '600',
      background: 'rgb(0, 112, 128)',
      foreground: 'rgb(255, 255, 255)',
      borderWidth: '0px',
      centeredBelowIcon: true,
      insideButton: true
    }))
  })
})
