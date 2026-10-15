import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { churnMemoryReleaseWindow } from './helpers/fork-memory-idle-churn'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForTerminalOutput,
  waitForActivePanePtyId,
  expectTerminalAccessibilityText,
  resolveActiveTabId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'
import {
  clickNewWindow,
  launchSecondWindow,
  quitSecondWindow,
  removeSlotProfiles,
  LAUNCH_RECORD_PATH,
  hubWorktrees,
  waitForHostWorktree,
  rowLocator
} from './helpers/fork-second-window'
import type { MemoryReleaseTestConfig } from '../../src/renderer/src/fork/memory-release/memory-release-contract'

const IDLE_DELAY_MS = 1500
const COUNTERFACTUAL = process.env.ORCA_MEMORY_RELEASE_COUNTERFACTUAL === '1'

test.use({
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_FORK_WINDOW_LAUNCH_RECORD: LAUNCH_RECORD_PATH
  }
})
test.setTimeout(240_000)

async function configure(page: Page, config: MemoryReleaseTestConfig): Promise<void> {
  await page.evaluate(async (config) => {
    if (!window.joseMemoryRelease?.configureTest) {
      throw new Error('Memory release E2E bridge unavailable')
    }
    await window.joseMemoryRelease.configureTest(config)
  }, config)
}

async function footprintFromMain(app: ElectronApplication): Promise<number> {
  const memory: unknown = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window.isVisible() || window.isFocused()) {
      throw new Error('Memory proof window must stay hidden')
    }
    return window.webContents.executeJavaScript('window.joseMemoryRelease.readFootprint()')
  })
  if (
    !memory ||
    typeof memory !== 'object' ||
    !('privateKB' in memory) ||
    typeof memory.privateKB !== 'number'
  ) {
    throw new Error(
      `Renderer process.getProcessMemoryInfo did not return private memory: ${JSON.stringify(memory)}`
    )
  }
  return memory.privateKB / 1024
}

async function sampleWindow(app: ElectronApplication): Promise<number[]> {
  const samples: number[] = []
  for (let index = 0; index < 5; index += 1) {
    samples.push(await footprintFromMain(app))
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return samples
}

function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
}

test('idle purge returns real private memory and preserves terminal input/output', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await configure(orcaPage, { delayMs: 3_600_000, disabled: COUNTERFACTUAL })
  await churnMemoryReleaseWindow(orcaPage, testRepoPath, registerPostElectronShutdownCleanup)
  await footprintFromMain(electronApp)
  // Let ordinary post-churn GC finish before measuring the additional idle purge.
  await new Promise((resolve) => setTimeout(resolve, 20_000))
  const heartbeatPath = path.join(testRepoPath, 'memory-heartbeat.cjs')
  writeFileSync(
    heartbeatPath,
    "let i=0; const timer=setInterval(()=>{console.log('PURGE_HEARTBEAT_'+(++i)); if(i===60)clearInterval(timer)},500)\n"
  )
  await execInTerminal(
    orcaPage,
    await waitForActivePanePtyId(orcaPage),
    nodeTerminalCommand([heartbeatPath])
  )
  await waitForTerminalOutput(orcaPage, 'PURGE_HEARTBEAT_1', 15_000)
  const rendererPidBefore = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
  )
  const measurementStartedAt = new Date().toISOString()
  const beforeSamplesMiB = await sampleWindow(electronApp)
  await configure(orcaPage, { delayMs: IDLE_DELAY_MS, disabled: COUNTERFACTUAL })
  await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS + 2500))
  const afterSamplesMiB = await sampleWindow(electronApp)
  const measurementEndedAt = new Date().toISOString()
  const rendererPidAfter = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
  )
  await waitForTerminalOutput(orcaPage, 'PURGE_HEARTBEAT_60', 35_000)
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.type(
    nodeTerminalCommand(['-e', "console.log('INPUT_'+'AFTER_PURGE_OK')"])
  )
  await orcaPage.keyboard.press('Enter')
  await waitForTerminalOutput(orcaPage, 'INPUT_AFTER_PURGE_OK', 15_000)
  const activeTab = await resolveActiveTabId(orcaPage)
  if (!activeTab) {
    throw new Error('Terminal tab disappeared after purge')
  }
  await expectTerminalAccessibilityText(orcaPage, activeTab, 'INPUT_AFTER_PURGE_OK')
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const trace = readFileSync(path.join(userData, 'logs', 'main.trace.ndjson'), 'utf8')
  const purgeTrace = trace.split('\n').filter((line) => line.includes('idle-release-'))
  const beforeCount = purgeTrace.filter((line) => line.includes('idle-release-before')).length
  const afterCount = purgeTrace.filter((line) => line.includes('idle-release-after')).length
  const skippedCount = purgeTrace.filter((line) => line.includes('idle-release-skipped')).length
  const beforeMiB = median(beforeSamplesMiB)
  const afterMiB = median(afterSamplesMiB)
  const evidence = {
    counterfactual: COUNTERFACTUAL,
    rendererPidBefore,
    rendererPidAfter,
    measurementStartedAt,
    measurementEndedAt,
    beforeSamplesMiB,
    afterSamplesMiB,
    beforeMiB,
    afterMiB,
    savedMiB: beforeMiB - afterMiB,
    savedPercent: (100 * (beforeMiB - afterMiB)) / beforeMiB,
    terminalOutputAndTyping: true,
    beforeCount,
    afterCount,
    skippedCount,
    purgeTrace
  }
  console.log('MEMORY_IDLE_RELEASE', JSON.stringify(evidence))
  await testInfo.attach('memory-idle-release.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json'
  })
  await testInfo.attach('main.trace.ndjson', { body: trace, contentType: 'application/x-ndjson' })
  expect(
    {
      savedAtLeast10MiB: evidence.savedMiB >= 10,
      sameRenderer: rendererPidBefore === rendererPidAfter,
      beforeCount,
      afterCount,
      skippedCount
    },
    JSON.stringify(evidence)
  ).toEqual({
    savedAtLeast10MiB: true,
    sameRenderer: true,
    beforeCount: 1,
    afterCount: COUNTERFACTUAL ? 0 : 1,
    skippedCount: COUNTERFACTUAL ? 1 : 0
  })
})

test('second-window slot releases once and keeps its paired terminal usable', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  await configure(orcaPage, { delayMs: 3_600_000, disabled: true })
  const worktrees = await hubWorktrees(orcaPage)
  const activeId = await orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId)
  const worktree = worktrees.find((item) => item.id !== activeId)
  if (!worktree) {
    throw new Error('Missing second workspace')
  }
  const slot = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
  try {
    const page = slot.page
    await configure(page, { delayMs: 3_600_000, disabled: false })
    await waitForHostWorktree(page, worktree.id)
    await rowLocator(page, worktree.id).click()
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.createTab(state.activeWorktreeId!)
    })
    await waitForActiveTerminalManager(page)
    await waitForActivePanePtyId(page)
    const beforeMiB = await footprintFromMain(slot.app)
    await configure(page, { delayMs: IDLE_DELAY_MS, disabled: false })
    await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS + 4000))
    const afterMiB = await footprintFromMain(slot.app)
    await focusActiveTerminalInput(page)
    await page.keyboard.type(nodeTerminalCommand(['-e', "console.log('SLOT_'+'AFTER_PURGE_OK')"]))
    await page.keyboard.press('Enter')
    await waitForTerminalOutput(page, 'SLOT_AFTER_PURGE_OK', 15_000)
    const tabId = await resolveActiveTabId(page)
    if (!tabId) {
      throw new Error('Slot terminal tab disappeared')
    }
    await expectTerminalAccessibilityText(page, tabId, 'SLOT_AFTER_PURGE_OK')
    const trace = readFileSync(path.join(slot.slotDir, 'logs', 'main.trace.ndjson'), 'utf8')
    const purgeTrace = trace.split('\n').filter((line) => line.includes('idle-release-'))
    const evidence = {
      beforeMiB,
      afterMiB,
      savedMiB: beforeMiB - afterMiB,
      slotProfile: path.basename(slot.slotDir),
      purgeTrace
    }
    console.log('MEMORY_IDLE_RELEASE_SLOT', JSON.stringify(evidence))
    await testInfo.attach('memory-idle-release-slot.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json'
    })
    expect(
      purgeTrace.map((line) => (line.includes('idle-release-after') ? 'after' : 'before'))
    ).toEqual(['before', 'after'])
  } finally {
    await quitSecondWindow(slot)
    removeSlotProfiles(userData)
  }
})
