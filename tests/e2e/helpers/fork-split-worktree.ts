import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './store'
import {
  readTerminalAccessibilityText,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './terminal'
import { runNodeScriptInTerminal } from './run-node-script-in-terminal'
import { waitForPtyShellEcho } from '../terminal-pty-readiness'

export const SPLIT_SETTING = 'Drag workspaces to split the view'

export type SplitFixtureWorkspace = { id: string; name: string }
export type SplitFixtureTerminal = { tabId: string; ptyId: string; leafId: string }

export function sidebarRow(page: Page, id: string): Locator {
  return page
    .locator(`[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(id)}]`)
    .first()
}

export function splitHeader(page: Page, id: string): Locator {
  return page.locator(`[data-jose-split-header=${JSON.stringify(id)}]`)
}

export async function prepareSplitWorkspaces(page: Page): Promise<SplitFixtureWorkspace[]> {
  await waitForSessionReady(page)
  await page.setViewportSize({ width: 1500, height: 920 })
  return page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('E2E store unavailable')
    }
    await store.getState().updateSettings({ uiLanguage: 'en', terminalHiddenViewParking: true })
    store.setState({
      groupBy: 'none',
      groupBySecondary: 'none',
      sidebarOpen: true,
      showActiveOnly: false,
      hideDefaultBranchWorkspace: false,
      filterRepoIds: []
    })
    return Object.values(store.getState().worktreesByRepo)
      .flat()
      .map((row) => ({
        id: row.id,
        name: row.displayName || row.branch || 'Workspace'
      }))
  })
}

export async function openSplitSettings(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    state?.setSettingsSearchQuery('Drag workspaces to split the view')
    state?.openSettingsTarget({ pane: 'general', repoId: null })
    state?.openSettingsPage()
  })
  const toggle = page.getByRole('switch', { name: SPLIT_SETTING, exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).toBeEnabled({ timeout: 30_000 })
  return toggle
}

export async function closeSplitSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.__store?.getState().closeSettingsPage())
  await expect(page.getByRole('switch', { name: SPLIT_SETTING, exact: true })).toBeHidden()
}

export async function beginSidebarDrag(page: Page, id: string): Promise<void> {
  const source = sidebarRow(page, id)
  await source.scrollIntoViewIfNeeded()
  const box = await source.boundingBox()
  if (!box) {
    throw new Error('Sidebar source has no bounds')
  }
  const x = box.x + box.width / 2
  const y = box.y + Math.min(box.height / 2, 24)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y, { steps: 3 })
}

export async function moveToSplitEdge(
  page: Page,
  edge: 'right' | 'center' = 'right'
): Promise<void> {
  const box = await page.locator('[data-jose-split-host]').boundingBox()
  if (!box) {
    throw new Error('Workspace host has no bounds')
  }
  await page.mouse.move(
    box.x + box.width * (edge === 'right' ? 0.9 : 0.5),
    box.y + box.height / 2,
    { steps: 12 }
  )
}

export async function dragOpenSplit(page: Page, id: string): Promise<void> {
  await beginSidebarDrag(page, id)
  try {
    await moveToSplitEdge(page)
    await expect(page.locator('[data-jose-split-drop-preview="right"]')).toBeVisible()
  } finally {
    await page.mouse.up()
  }
  await expect(splitHeader(page, id)).toBeVisible({ timeout: 30_000 })
}

export async function activateFixtureTerminal(
  page: Page,
  id: string
): Promise<SplitFixtureTerminal> {
  await sidebarRow(page, id).click()
  await ensureTerminalVisible(page, 30_000)
  await waitForActiveTerminalManager(page)
  const snapshot = await waitForPaneIdentitySnapshot(page, 1)
  const pane = snapshot.panes[0]
  if (!pane?.ptyId) {
    throw new Error('Fixture terminal has no live PTY')
  }
  await waitForPtyShellEcho(page, pane.ptyId, 30_000)
  return { tabId: snapshot.tabId, ptyId: pane.ptyId, leafId: pane.leafId }
}

export async function startSplitHeartbeat(
  page: Page,
  terminal: SplitFixtureTerminal,
  label: string,
  directory: string
): Promise<string> {
  const heartbeat = path.join(directory, `${label}.json`)
  const staged = await runNodeScriptInTerminal(
    page,
    terminal.ptyId,
    [
      "const fs = require('node:fs')",
      'let tick = 0',
      `setInterval(() => { tick += 1; fs.writeFileSync(${JSON.stringify(heartbeat)}, JSON.stringify({ pid: process.pid, tick })); console.log(${JSON.stringify(label)} + ':' + tick) }, 250)`
    ].join('\n'),
    { dir: directory }
  )
  await expect
    .poll(() => readTerminalAccessibilityText(page, terminal.tabId), { timeout: 30_000 })
    .toContain(`${label}:`)
  staged.cleanup()
  return heartbeat
}

export function readHeartbeat(file: string): { pid: number; tick: number } {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (
      value &&
      typeof value === 'object' &&
      'pid' in value &&
      typeof value.pid === 'number' &&
      'tick' in value &&
      typeof value.tick === 'number'
    ) {
      return { pid: value.pid, tick: value.tick }
    }
  } catch {
    // A reader can race the fixture's short write.
  }
  return { pid: 0, tick: 0 }
}

export async function renderedTick(page: Page, tabId: string, label: string): Promise<number> {
  const text = await readTerminalAccessibilityText(page, tabId)
  return Math.max(
    0,
    ...Array.from((text ?? '').matchAll(new RegExp(`${label}:(\\d+)`, 'g')), (match) =>
      Number(match[1])
    )
  )
}

export async function splitScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const directory = process.env.ORCA_SPLIT_SCREENSHOT_DIR ?? testInfo.outputPath('screens')
  mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${name}.png`)
  await page.screenshot({ path: file })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}
