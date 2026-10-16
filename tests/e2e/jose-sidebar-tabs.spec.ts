import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('quiet sidebar tabs, live file count and keyboard diff actions', async ({
  orcaPage,
  electronApp
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    await state.updateSettingsOrThrow({
      theme: 'dark',
      modernUi: true,
      modernUiTabStyle: 'connected'
    })
    await window.api.ui.set({ uiZoomLevel: 0.5 })
  })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    document.documentElement.dataset.joseUi = 'vscode'
    state.setActivityBarPosition('top')
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('explorer')
  })
  const sidebar = orcaPage.locator('[data-orca-region="right-sidebar"]')
  const sourceControl = sidebar.locator('[data-sidebar-activity="source-control"]')
  const badge = sourceControl.locator('[data-sidebar-change-count]')
  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(state.activeWorktreeId!)
    if (!worktree) {
      throw new Error('No active fixture worktree')
    }
    return worktree.path
  })
  await writeFile(
    path.join(worktreePath, 'src', 'index.ts'),
    'export const hello = "sidebar change"\n'
  )
  await badge.filter({ hasText: /^1$/ }).waitFor({ timeout: 20_000 })
  const zoom = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()
  )
  await sourceControl.click()
  const row = sidebar.locator(
    '[data-source-control-path="src/index.ts"][data-source-control-area="unstaged"]'
  )
  await row.waitFor()
  await row.focus()
  await row.press('Enter')
  await sidebar.locator('[data-source-control-path="src/index.ts"][data-current="true"]').waitFor()
  await orcaPage.locator('.monaco-diff-editor').waitFor()
  await orcaPage.mouse.move(0, 0)
  const actionsVisible = await row
    .locator('[data-source-control-row-actions]')
    .evaluate((element) => getComputedStyle(element).opacity)
  const activeStyle = await sourceControl.evaluate((element) => ({
    color: getComputedStyle(element).color,
    tile: getComputedStyle(element, '::before').backgroundColor,
    underline: Array.from(element.querySelectorAll('div.bg-foreground')).some(
      (marker) => getComputedStyle(marker).display !== 'none'
    ),
    current: element.getAttribute('aria-current')
  }))
  const screenshotDirectory = process.env.JOSE_SIDEBAR_SCREENSHOT_DIR
  const cdp = await orcaPage.context().newCDPSession(orcaPage)
  async function screenshot(name: string): Promise<void> {
    if (!screenshotDirectory) {
      return
    }
    await mkdir(screenshotDirectory, { recursive: true })
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(screenshotDirectory, name), Buffer.from(data, 'base64'))
  }
  if (screenshotDirectory) {
    await screenshot('sidebar-dark-connected.png')
  }
  await row.getByRole('button', { name: 'Stage', exact: true }).click()
  const staged = sidebar.locator(
    '[data-source-control-path="src/index.ts"][data-source-control-area="staged"]'
  )
  await staged.waitFor()
  const stagedCount = await badge.textContent()
  await writeFile(
    path.join(worktreePath, 'src', 'index.ts'),
    'export const hello = "partially staged"\n'
  )
  await row.waitFor({ timeout: 20_000 })
  await badge.filter({ hasText: /^2$/ }).waitFor({ timeout: 20_000 })
  const partiallyStagedCount = await badge.textContent()
  await staged.hover()
  await staged.getByRole('button', { name: 'Unstage', exact: true }).click()
  await staged.waitFor({ state: 'detached' })
  await sidebar.locator('[data-sidebar-activity="explorer"]').click()
  const badgeStates: {
    count: string | null
    iconClear: boolean
    insideButton: boolean
    description: string | null
  }[] = []
  let previousCount = 1
  for (const count of [1, 9, 42, 100]) {
    await Promise.all(
      Array.from({ length: count - previousCount }, (_, index) =>
        writeFile(path.join(worktreePath, `new-${previousCount + index}.txt`), 'new\n')
      )
    )
    previousCount = count
    const label = String(count)
    await badge
      .filter({ hasText: new RegExp(`^${label.replace('+', '\\+')}$`) })
      .waitFor({ timeout: 20_000 })
    badgeStates.push(
      await sourceControl.evaluate((element) => {
        const icon = element.querySelector('svg')!.getBoundingClientRect()
        const badge = element.querySelector('[data-sidebar-change-count]')!
        const badgeBox = badge.getBoundingClientRect()
        const button = element.getBoundingClientRect()
        return {
          count: badge.textContent,
          iconClear: badgeBox.top >= icon.top + icon.height / 2 - 0.5,
          insideButton: badgeBox.right <= button.right + 1 && badgeBox.bottom <= button.bottom + 1,
          description: element.getAttribute('aria-description')
        }
      })
    )
    await screenshot(`sidebar-dark-count-${count}.png`)
  }
  await cdp.detach()
  expect({
    zoom,
    actionsVisible,
    activeStyle,
    stagedCount,
    partiallyStagedCount,
    badgeStates,
    lastCount: await badge.textContent()
  }).toEqual({
    zoom: 0.5,
    actionsVisible: '1',
    activeStyle: {
      color: 'rgb(255, 255, 255)',
      tile: 'rgb(41, 41, 41)',
      underline: false,
      current: 'page'
    },
    stagedCount: '1',
    partiallyStagedCount: '2',
    badgeStates: [
      { count: '1', iconClear: true, insideButton: true, description: '1 wijziging' },
      { count: '9', iconClear: true, insideButton: true, description: '9 wijzigingen' },
      { count: '42', iconClear: true, insideButton: true, description: '42 wijzigingen' },
      { count: '100', iconClear: true, insideButton: true, description: '100 wijzigingen' }
    ],
    lastCount: '100'
  })
})
