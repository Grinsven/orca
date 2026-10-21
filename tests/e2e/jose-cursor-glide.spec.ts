import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { runNodeScriptInTerminal } from './helpers/run-node-script-in-terminal'
import {
  AGENT_INPUT_BOX_SCRIPT,
  glideFrameIntervals,
  intervalStats,
  intervalsOf,
  midGlideFrames,
  startGlideRecorder,
  startScreencast,
  stopGlideRecorder
} from './jose-cursor-glide-probes'

const PROOF_DIR = process.env.JOSE_CURSOR_GLIDE_PROOF_DIR

async function typeAndRecord(page: Page, text: string, screencastName: string | null) {
  await focusActiveTerminalInput(page)
  const screencast =
    PROOF_DIR && screencastName
      ? await startScreencast(page, path.join(PROOF_DIR, screencastName))
      : null
  await startGlideRecorder(page)
  // 110 ms apart: slower than key repeat, so every echo is a typed move, not a stream.
  await page.keyboard.type(text, { delay: 110 })
  await page.waitForTimeout(300)
  const record = await stopGlideRecorder(page)
  const savedFrames = (await screencast?.stop()) ?? 0
  return { ...record, savedFrames }
}

async function cursorClipRect(page: Page) {
  return page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.xterm-screen')
    const rect = screen?.getBoundingClientRect()
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })
}

test('cursor glides on typed moves and fades calmly with Jose settings', async ({
  orcaPage,
  electronApp
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const portable = JSON.parse(await readFile('jose-setup/files/orca-settings.json', 'utf8'))
  await orcaPage.evaluate(async (jose) => {
    await window.__store!.getState().updateSettingsOrThrow({
      theme: 'dark',
      modernUi: true,
      modernUiTabStyle: 'connected',
      terminalCustomThemes: jose.terminalCustomThemes,
      terminalThemeDark: jose.terminalThemeDark,
      terminalFontFamily: jose.terminalFontFamily,
      terminalFontSize: jose.terminalFontSize,
      terminalLineHeight: jose.terminalLineHeight,
      terminalCursorStyle: 'block',
      terminalCursorBlink: false
    })
    await window.api.ui.set({ uiZoomLevel: 0.5 })
  }, portable.settings)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await waitForActiveTerminalManager(orcaPage)
  const ptyId = await waitForActivePanePtyId(orcaPage)

  // Shell prompt: each echoed character moves the cursor one cell. Timing runs without the
  // screencast, which encodes a PNG per frame; a second pass records the proof frames.
  const shell = await typeAndRecord(orcaPage, 'echo smooth cursor', null)
  const shellGlides = midGlideFrames(shell.frames, shell.cellWidth)
  const typingStats = intervalStats(intervalsOf(shell.frames))
  const glideRuns = glideFrameIntervals(shell.frames)
  const glideStats = intervalStats(glideRuns.flatMap(intervalsOf))
  const glideFrameWork = intervalStats(glideRuns.flat().map((frame) => frame.workMs))
  const proof = await typeAndRecord(orcaPage, ' typed', 'shell-frames')
  expect(shell.cellWidth).toBeGreaterThan(0)
  expect(shellGlides.length).toBeGreaterThan(10)
  await expect(orcaPage.locator('.xterm-screen .orca-cursor-glide')).toHaveAttribute(
    'data-visible',
    'false'
  )
  const overlayColor = await orcaPage
    .locator('.xterm-screen .orca-cursor-glide')
    .evaluate((element) => getComputedStyle(element).backgroundColor)

  // Claude Code's input box shape: home, repaint, park on the last row, back to the caret.
  await sendToTerminal(orcaPage, ptyId, '\x15')
  const staged = await runNodeScriptInTerminal(orcaPage, ptyId, AGENT_INPUT_BOX_SCRIPT)
  await waitForTerminalOutput(orcaPage, 'agent box ready')
  const agent = await typeAndRecord(orcaPage, 'hello agent', 'agent-frames')
  const agentGlides = midGlideFrames(agent.frames, agent.cellWidth)
  expect(agentGlides.length).toBeGreaterThan(5)
  await orcaPage.keyboard.press('Control+C')
  staged.cleanup()

  // Calm blink: solid while typing, then soft fades that never drop below 28 percent.
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettingsOrThrow({ terminalCursorBlink: true })
  )
  await focusActiveTerminalInput(orcaPage)
  await startGlideRecorder(orcaPage)
  await orcaPage.waitForTimeout(2600)
  const blink = await stopGlideRecorder(orcaPage)
  const opacities = blink.frames.filter((frame) => frame.visible).map((frame) => frame.opacity)
  expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.279)
  expect(Math.min(...opacities)).toBeLessThan(0.3)
  expect(opacities.some((opacity) => opacity > 0.4 && opacity < 0.9)).toBe(true)

  // A blurred pane keeps xterm's hollow outline and no overlay.
  await orcaPage.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  await expect(orcaPage.locator('.xterm-screen .orca-cursor-glide')).toHaveAttribute(
    'data-visible',
    'false'
  )

  // Turning the setting off gives the stock snapping cursor back.
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettingsOrThrow({
      terminalCursorBlink: false,
      terminalCursorGlide: false
    })
  )
  const off = await typeAndRecord(orcaPage, ' off', null)
  expect(off.frames.filter((frame) => frame.visible)).toHaveLength(0)

  const report = {
    typingFrameIntervals: typingStats,
    glideFrameIntervals: glideStats,
    glideFrameMainThreadWork: glideFrameWork,
    shellMidGlideFrames: shellGlides.length,
    glides: glideRuns.length,
    framesPerGlide: glideRuns.map((run) => run.length),
    agentMidGlideFrames: agentGlides.length,
    blinkMinOpacity: Math.min(...opacities),
    overlayColor,
    screencastFrames: { shell: proof.savedFrames, agent: agent.savedFrames },
    proofFrames: proof.frames,
    screenRect: await cursorClipRect(orcaPage),
    shellFrames: shell.frames,
    cellWidth: shell.cellWidth
  }
  console.log(
    `cursor-glide: ${JSON.stringify({ typingStats, glideStats, glideFrameWork, shellMid: shellGlides.length, agentMid: agentGlides.length, overlayColor })}`
  )
  if (PROOF_DIR) {
    await mkdir(PROOF_DIR, { recursive: true })
    await writeFile(path.join(PROOF_DIR, 'report.json'), JSON.stringify(report, null, 2))
  }
})
