import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForTabParked } from './helpers/terminal-hidden-parking'
import {
  activateFixtureTerminal,
  beginSidebarDrag,
  closeSplitSettings,
  dragOpenSplit,
  moveToSplitEdge,
  openSplitSettings,
  prepareSplitWorkspaces,
  readHeartbeat,
  renderedTick,
  sidebarRow,
  splitHeader,
  splitScreenshot,
  startSplitHeartbeat
} from './helpers/fork-split-worktree'
import {
  clickNewWindow,
  LAUNCH_RECORD_PATH,
  launchSecondWindow,
  quitSecondWindow,
  removeSlotProfiles,
  type SecondWindow
} from './helpers/fork-second-window'

test.use({
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_E2E_TERMINAL_PARKING_DELAY_MS: '500',
    ORCA_FORK_WINDOW_LAUNCH_RECORD: LAUNCH_RECORD_PATH
  }
})

test('sidebar split keeps both PTYs live, parks on close, and preserves explicit board drops', async ({
  orcaPage: page,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  const [a, b] = await prepareSplitWorkspaces(page)
  if (!a || !b) {
    throw new Error('Two fixture workspaces are required')
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-split-heartbeats-'))
  registerPostElectronShutdownCleanup(async () => {
    rmSync(scratch, { recursive: true, force: true })
  })
  const toggle = await openSplitSettings(page)
  await expect(toggle).toBeChecked()
  await closeSplitSettings(page)
  const terminalB = await activateFixtureTerminal(page, b.id)
  const heartbeatB = await startSplitHeartbeat(page, terminalB, 'SPLIT_B', scratch)
  const terminalA = await activateFixtureTerminal(page, a.id)
  await startSplitHeartbeat(page, terminalA, 'SPLIT_A', scratch)

  await beginSidebarDrag(page, b.id)
  try {
    await moveToSplitEdge(page)
    const preview = page.locator('[data-jose-split-drop-preview="right"]')
    await expect(preview).toBeVisible()
    await expect(page.locator('[data-workspace-board-sheet]')).toHaveCount(0)
    const host = await page.locator('[data-jose-split-host]').boundingBox()
    const half = await preview.boundingBox()
    if (!host || !half) {
      throw new Error('Split preview has no bounds')
    }
    expect(Math.abs(half.width - host.width / 2)).toBeLessThan(2)
    expect(Math.abs(half.x - host.x - host.width / 2)).toBeLessThan(2)
    await splitScreenshot(page, testInfo, 'overlay')
  } finally {
    await page.mouse.up()
  }
  await expect(splitHeader(page, a.id)).toBeVisible({ timeout: 30_000 })
  await expect(splitHeader(page, b.id)).toBeVisible()
  await expect(page.locator('[data-workspace-board-sheet]')).toHaveCount(0)
  const firstA = await renderedTick(page, terminalA.tabId, 'SPLIT_A')
  const firstB = await renderedTick(page, terminalB.tabId, 'SPLIT_B')
  await expect
    .poll(() => renderedTick(page, terminalA.tabId, 'SPLIT_A'))
    .toBeGreaterThan(firstA + 4)
  await expect
    .poll(() => renderedTick(page, terminalB.tabId, 'SPLIT_B'))
    .toBeGreaterThan(firstB + 4)
  await splitScreenshot(page, testInfo, 'split')

  const paneB = page.locator(
    `[data-terminal-tab-id=${JSON.stringify(terminalB.tabId)}] .pane[data-leaf-id=${JSON.stringify(terminalB.leafId)}]`
  )
  await expect(paneB).toHaveAttribute('data-pty-id', terminalB.ptyId)
  const beforeClose = readHeartbeat(heartbeatB)
  await splitHeader(page, b.id)
    .getByRole('button', { name: `Close ${b.name} split`, exact: true })
    .click()
  await expect(page.locator('[data-jose-split-header]')).toHaveCount(0)
  await waitForTabParked(page, terminalB.tabId)
  await expect(paneB).toHaveCount(0)
  await expect.poll(() => readHeartbeat(heartbeatB).tick).toBeGreaterThan(beforeClose.tick + 4)
  expect(readHeartbeat(heartbeatB).pid).toBe(beforeClose.pid)
  const whileParked = readHeartbeat(heartbeatB).tick
  await dragOpenSplit(page, b.id)
  await expect(paneB).toHaveAttribute('data-pty-id', terminalB.ptyId, { timeout: 30_000 })
  await expect
    .poll(() => renderedTick(page, terminalB.tabId, 'SPLIT_B'), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(whileParked)

  await beginSidebarDrag(page, b.id)
  try {
    await moveToSplitEdge(page, 'center')
    await expect(page.locator('[data-jose-split-drop-preview]')).toHaveCount(0)
  } finally {
    await page.mouse.up()
  }
  await expect(page.locator('[data-jose-split-header]')).toHaveCount(2)

  // A completed sidebar drag briefly suppresses click-through on the next control.
  await page.waitForTimeout(600)
  await page.locator('[data-workspace-board-trigger]').click()
  const board = page.locator('[data-workspace-board-sheet]')
  await expect(board).toBeVisible()
  const lane = board.locator(
    '[data-workspace-status-drop-target][data-workspace-status="in-review"]'
  )
  await expect(
    lane.locator(`[data-workspace-board-worktree-id=${JSON.stringify(b.id)}]`)
  ).toHaveCount(0)
  await lane.scrollIntoViewIfNeeded()
  const laneBox = await lane.boundingBox()
  if (!laneBox) {
    throw new Error('Board lane has no bounds')
  }
  await beginSidebarDrag(page, b.id)
  try {
    await page.mouse.move(laneBox.x + laneBox.width / 2, laneBox.y + 100, { steps: 12 })
    await expect(page.locator('[data-jose-split-drop-preview]')).toHaveCount(0)
  } finally {
    await page.mouse.up()
  }
  await expect(
    lane.locator(`[data-workspace-board-worktree-id=${JSON.stringify(b.id)}]`)
  ).toBeVisible({ timeout: 30_000 })
  await splitScreenshot(page, testInfo, 'board-open')
  await page.waitForTimeout(600)
  await board.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(board).toHaveCount(0)
  await expect(sidebarRow(page, b.id)).toBeVisible()
})

test('drag preference synchronizes windows and survives a window restart with legacy dragging off', async ({
  electronApp,
  orcaPage: hub
}, testInfo) => {
  test.setTimeout(240_000)
  const [a, b] = await prepareSplitWorkspaces(hub)
  if (!a || !b) {
    throw new Error('Two fixture workspaces are required')
  }
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  let secondary: SecondWindow | null = null
  try {
    secondary = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
    const secondToggle = await openSplitSettings(secondary.page)
    const hubToggle = await openSplitSettings(hub)
    await expect(hubToggle).toBeChecked()
    await expect(secondToggle).toBeChecked()
    await hubToggle.click()
    await expect(hubToggle).not.toBeChecked()
    await expect(secondToggle).not.toBeChecked({ timeout: 30_000 })
    await quitSecondWindow(secondary)
    secondary = null
    secondary = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
    const restartedToggle = await openSplitSettings(secondary.page)
    await expect(restartedToggle).not.toBeChecked()
    await closeSplitSettings(hub)
    await sidebarRow(hub, a.id).click()
    await beginSidebarDrag(hub, b.id)
    try {
      await expect(hub.locator('[data-workspace-board-sheet]')).toBeVisible()
      await expect(hub.locator('[data-jose-split-drop-preview]')).toHaveCount(0)
      await hub.keyboard.press('Escape')
    } finally {
      await hub.mouse.up()
    }
    await expect(hub.locator('[data-workspace-board-sheet]')).toHaveCount(0)
    await restartedToggle.click()
    await expect(restartedToggle).toBeChecked()
    await expect(await openSplitSettings(hub)).toBeChecked({ timeout: 30_000 })
  } finally {
    if (secondary) {
      await quitSecondWindow(secondary)
    }
    removeSlotProfiles(userData)
  }
})
