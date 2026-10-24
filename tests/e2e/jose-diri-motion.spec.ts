import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  captureSidebar,
  nextFrame,
  recordFold,
  recordTabStrip,
  seekSidebarAnimations,
  type FoldFrame,
  type TabFrame
} from './jose-diri-motion-probes'

const PROOF_DIR = process.env.JOSE_DIRI_MOTION_PROOF_DIR
const PINNED_HEADER = '[role="button"][data-workspace-pin-drop-target]'

function track(frames: readonly FoldFrame[], key: string) {
  // Why the time filter: a frame sampled twice is one painted frame, not a frame that held still.
  return frames
    .filter((frame, index) => index === 0 || frame.t !== frames[index - 1].t)
    .flatMap((frame) => {
      const sample = frame.rows[key]
      return sample ? [{ t: frame.t, ...sample }] : []
    })
}

/** A row that glides: starts where it was, moves every frame, ends where it belongs, no jumps. */
function glideReport(
  frames: readonly FoldFrame[],
  key: string,
  before: number,
  durationMs: number
) {
  const samples = track(frames, key)
  const after = samples.at(-1)?.top ?? before
  const distance = Math.abs(after - before)
  const steps = samples.slice(1).map((sample, index) => ({
    t: sample.t,
    step: Math.abs(sample.top - samples[index].top)
  }))
  // Why from the first move: a Web Animation starts on the frame after the commit that made it,
  // so the start position may be painted twice; that frame holds, it never jumps.
  const firstMove = steps.findIndex((entry) => entry.step >= 0.05)
  return {
    distance,
    firstFrameShift: Math.abs((samples[0]?.top ?? before) - before) / distance,
    largestStep: Math.max(...steps.map((entry) => entry.step)) / distance,
    startsWithinFrames: firstMove + 1,
    // Then every frame moves the row until the soft landing, where steps go sub-pixel.
    stillFrames: steps
      .slice(Math.max(0, firstMove))
      .filter((entry) => entry.t < durationMs * 0.75 && entry.step < 0.05).length,
    settled: Math.abs(
      (samples.find((sample) => sample.t >= durationMs + 20)?.top ?? Number.NaN) - after
    )
  }
}

function isMonotonic(values: readonly number[], direction: 1 | -1): boolean {
  return values.every(
    (value, index) => index === 0 || (value - values[index - 1]) * direction >= -1e-3
  )
}

async function foldTo(page: Page, open: boolean): Promise<void> {
  const header = page.locator(PINNED_HEADER)
  if ((await header.getAttribute('aria-expanded')) !== String(open)) {
    await header.click()
  }
  await expect(header).toHaveAttribute('aria-expanded', String(open))
  await page.waitForTimeout(400)
}

async function sidebarAnimationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sidebar = document.querySelector('[data-worktree-sidebar-container]')
    return document
      .getAnimations()
      .filter(
        (animation) =>
          !(animation instanceof CSSTransition) &&
          !(animation instanceof CSSAnimation) &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target !== null &&
          sidebar?.contains(animation.effect.target)
      ).length
  })
}

function tabGrowReport(frames: readonly TabFrame[], id: string) {
  const widths = frames.flatMap((frame) => {
    const slot = frame.slots.find((candidate) => candidate.id === id)
    return slot ? [{ t: frame.t, width: slot.width }] : []
  })
  const final = widths.at(-1)?.width ?? 0
  const growing = widths.filter((sample) => sample.width < final - 0.5)
  const buttonMoves = frames.filter(
    (frame, index) => index > 0 && frame.newTabButtonLeft !== frames[index - 1].newTabButtonLeft
  ).length
  return {
    final,
    firstWidth: (widths[0]?.width ?? 0) / final,
    monotonic: isMonotonic(
      widths.map((sample) => sample.width),
      1
    ),
    growingFrames: growing.length,
    doneByMs: Math.round(widths.find((sample) => sample.width >= final - 0.5)?.t ?? Infinity),
    buttonMoves
  }
}

test('sidebar groups, cards and tabs move with Diri motion', async ({ orcaPage, electronApp }) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const createdIds = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    state.setGroupBy('none')
    state.setShowSleepingWorkspaces(true)
    const repoId = state.allWorktrees()[0]?.repoId
    if (!repoId) {
      throw new Error('seed repo was not loaded')
    }
    const created: string[] = []
    for (const name of ['diri-motion-a', 'diri-motion-b', 'diri-motion-c']) {
      created.push((await state.createWorktree(repoId, name, undefined, 'skip')).worktree.id)
    }
    return created
  })
  await expect
    .poll(() =>
      orcaPage.locator('[data-worktree-sidebar] [role="option"][data-worktree-id]').count()
    )
    .toBeGreaterThanOrEqual(5)
  const activeWorktreeId = await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettingsOrThrow({
      theme: 'dark',
      modernUi: true,
      modernUiTabStyle: 'connected',
      experimentalNewWorktreeCardStyle: true
    })
  })
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  const pinnedIds = createdIds.filter((id) => id !== activeWorktreeId).slice(0, 2)
  await orcaPage.evaluate(async (ids) => {
    const state = window.__store!.getState()
    for (const id of ids) {
      await state.updateWorktreeMeta(id, { isPinned: true })
    }
  }, pinnedIds)
  await orcaPage.locator(PINNED_HEADER).waitFor()
  await foldTo(orcaPage, true)
  const keys = await orcaPage.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-worktree-sidebar] [data-worktree-virtual-row-key]:not([data-worktree-sticky-header-active])'
      )
    ).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
    const keyOf = (row: HTMLElement) => row.dataset.worktreeVirtualRowKey ?? ''
    const pinned = rows.filter((row) => row.querySelector('[data-worktree-section-key="pinned"]'))
    const lastPinned = rows.indexOf(pinned.at(-1)!)
    return {
      pinned: pinned.map(keyOf),
      below: rows.slice(lastPinned + 1, lastPinned + 4).map(keyOf)
    }
  })
  expect(keys.pinned).toHaveLength(2)
  const watched = [...keys.pinned, ...keys.below]

  // Close: copies stay painted and fade while rows below glide up every frame.
  const close = await recordFold(orcaPage, {
    trigger: PINNED_HEADER,
    rows: watched,
    durationMs: 420
  })
  await expect(orcaPage.locator(PINNED_HEADER)).toHaveAttribute('aria-expanded', 'false')
  const copyOpacity = close.frames.map((frame) => frame.copies[0] ?? 0)
  const closeReport = {
    longTasks: close.longTasks,
    rowsGoneAtOnce: keys.pinned.every((key) => close.frames.every((frame) => !frame.rows[key])),
    copiesAtFirstFrame: close.frames[0]?.copies.length,
    firstCopyOpacity: copyOpacity[0],
    copiesStillPaintedAt: Math.round(
      close.frames.findLast((frame) => frame.copies.length > 0)?.t ?? 0
    ),
    copiesGoneBy: Math.round(
      close.frames.find((frame) => frame.t > 100 && frame.copies.length === 0)?.t ?? Infinity
    ),
    copyFadeMonotonic: isMonotonic(
      close.frames.filter((frame) => frame.copies.length > 0).map((frame) => frame.copies[0] ?? 0),
      -1
    ),
    below: keys.below.map((key) => glideReport(close.frames, key, close.before[key]?.top ?? 0, 180))
  }

  // Open: rows fade in from above with the stagger; rows below glide down every frame.
  const open = await recordFold(orcaPage, {
    trigger: PINNED_HEADER,
    rows: watched,
    durationMs: 480
  })
  await expect(orcaPage.locator(PINNED_HEADER)).toHaveAttribute('aria-expanded', 'true')
  const openRows = keys.pinned.map((key) => track(open.frames, key))
  const openReport = {
    longTasks: open.longTasks,
    firstRowFirstFrame: openRows[0]?.[0] && {
      opacity: openRows[0][0].opacity,
      translateY: openRows[0][0].translateY
    },
    secondRowStartsLater:
      (openRows[1]?.find((sample) => sample.opacity > 0)?.t ?? 0) >
      (openRows[0]?.find((sample) => sample.opacity > 0)?.t ?? Infinity),
    fadeMonotonic: openRows.every((samples) =>
      isMonotonic(
        samples.map((sample) => sample.opacity),
        1
      )
    ),
    slideMonotonic: openRows.every((samples) =>
      isMonotonic(
        samples.map((sample) => sample.translateY),
        1
      )
    ),
    landed: openRows.map((samples) => samples.find((sample) => sample.t >= 320)),
    below: keys.below.map((key) => glideReport(open.frames, key, open.before[key]?.top ?? 0, 300))
  }

  // Exact frames: hold the fold's animations at a time and capture the sidebar.
  const captures: string[] = []
  if (PROOF_DIR) {
    await foldTo(orcaPage, false)
    await orcaPage.locator(PINNED_HEADER).click()
    await nextFrame(orcaPage)
    for (const ms of [50, 150, 300]) {
      expect(await seekSidebarAnimations(orcaPage, ms)).toBeGreaterThan(0)
      captures.push(await captureSidebar(orcaPage, PROOF_DIR, `open-${ms}ms.png`))
    }
    await seekSidebarAnimations(orcaPage, 'finish')
    await orcaPage.waitForTimeout(400)
    await orcaPage.locator(PINNED_HEADER).click()
    await nextFrame(orcaPage)
    expect(await seekSidebarAnimations(orcaPage, 90)).toBeGreaterThan(0)
    captures.push(await captureSidebar(orcaPage, PROOF_DIR, 'close-90ms.png'))
    await seekSidebarAnimations(orcaPage, 'finish')
    await foldTo(orcaPage, true)
  }

  // Card fills: the hover fill appears at once and springs out; selection springs in.
  const cardTimings = await orcaPage.evaluate(() => {
    const read = (selector: string) => {
      const surface = document.querySelector<HTMLElement>(`[data-worktree-sidebar] ${selector}`)
      if (!surface) {
        return null
      }
      const style = getComputedStyle(surface)
      return {
        duration: style.transitionDuration,
        linearEasing: style.transitionTimingFunction.startsWith('linear(')
      }
    }
    return {
      resting: read('[data-worktree-card-surface]:not([data-worktree-card-active])'),
      selected: read('[data-worktree-card-surface][data-worktree-card-active]')
    }
  })

  // Reduce Motion: a fold lands at once.
  await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
  const reducedCloseRun = await recordFold(orcaPage, {
    trigger: PINNED_HEADER,
    rows: [],
    durationMs: 60
  })
  const reducedClose = {
    animations: await sidebarAnimationCount(orcaPage),
    copies: await orcaPage.locator('[data-worktree-fold-overlay] > *').count()
  }
  await orcaPage.locator(PINNED_HEADER).click()
  await nextFrame(orcaPage)
  const reducedOpen = { animations: await sidebarAnimationCount(orcaPage) }
  await orcaPage.emulateMedia({ reducedMotion: 'no-preference' })

  // Tabs: a new tab grows from 0, a closed one stays painted while it shrinks.
  await ensureTerminalVisible(orcaPage)
  const opened = await recordTabStrip(orcaPage, {
    action: 'open',
    worktreeId: activeWorktreeId,
    durationMs: 320
  })
  const grow = tabGrowReport(opened.frames, opened.createdId ?? '')
  await orcaPage.waitForTimeout(200)
  const closed = await recordTabStrip(orcaPage, {
    action: 'close',
    worktreeId: activeWorktreeId,
    tabId: opened.createdId ?? undefined,
    durationMs: 300
  })
  const ghostWidths = closed.frames.flatMap((frame) => (frame.ghost === null ? [] : [frame.ghost]))
  const shrink = {
    firstGhostWidth: (ghostWidths[0] ?? 0) / grow.final,
    monotonic: isMonotonic(ghostWidths, -1),
    paintedFrames: ghostWidths.length,
    goneBy: Math.round(
      closed.frames.find((frame) => frame.t > 50 && frame.ghost === null)?.t ?? Infinity
    ),
    slotsExcludeCopy: closed.frames.every((frame) =>
      frame.slots.every((slot) => slot.id !== opened.createdId)
    )
  }

  // List ends: the top fade ramps in over the first 14 px of scroll.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 420)
  })
  await orcaPage.waitForTimeout(300)
  const endFade = await orcaPage.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-worktree-sidebar]')!
    const container = document.querySelector<HTMLElement>('[data-worktree-sidebar-container]')!
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    // Why read scrollTop back: the list may settle a requested offset elsewhere.
    const samples: { scrollTop: number; strength: number }[] = []
    for (const top of [0, 3, 5, 7, 10, 14, 40]) {
      scroller.scrollTop = top
      await frame()
      await frame()
      samples.push({
        scrollTop: scroller.scrollTop,
        strength: Number(container.style.getPropertyValue('--list-top-fade'))
      })
    }
    scroller.scrollTop = 0
    return {
      scrollable: scroller.scrollHeight > scroller.clientHeight + 40,
      mask: getComputedStyle(scroller).maskImage.startsWith('linear-gradient('),
      samples
    }
  })

  console.log(
    `diri-motion long tasks: ${JSON.stringify({ close: close.longTasks, open: open.longTasks, reducedClose: reducedCloseRun.longTasks })}`
  )
  const report = {
    closeReport,
    openReport,
    captures,
    cardTimings,
    reducedClose,
    reducedOpen,
    grow,
    shrink,
    endFade
  }
  console.log(`diri-motion: ${JSON.stringify(report)}`)
  if (PROOF_DIR) {
    await mkdir(PROOF_DIR, { recursive: true })
    await writeFile(
      path.join(PROOF_DIR, 'report.json'),
      JSON.stringify(
        {
          ...report,
          closeFrames: close.frames,
          openFrames: open.frames,
          tabOpenFrames: opened.frames,
          tabCloseFrames: closed.frames
        },
        null,
        2
      )
    )
  }

  expect(closeReport.rowsGoneAtOnce).toBe(true)
  expect(closeReport.copiesAtFirstFrame).toBe(2)
  expect(closeReport.firstCopyOpacity).toBeGreaterThan(0.85)
  expect(closeReport.copiesStillPaintedAt).toBeGreaterThanOrEqual(150)
  expect(closeReport.copiesGoneBy).toBeLessThan(260)
  expect(closeReport.copyFadeMonotonic).toBe(true)
  for (const below of closeReport.below) {
    expect(below.distance).toBeGreaterThan(20)
    expect(below.firstFrameShift).toBeLessThan(0.35)
    expect(below.largestStep).toBeLessThan(0.4)
    expect(below.startsWithinFrames).toBeLessThanOrEqual(2)
    expect(below.stillFrames).toBe(0)
    expect(below.settled).toBeLessThan(0.5)
  }
  expect(openReport.firstRowFirstFrame?.opacity).toBeLessThan(0.3)
  expect(openReport.firstRowFirstFrame?.translateY).toBeLessThan(-3.5)
  expect(openReport.secondRowStartsLater).toBe(true)
  expect(openReport.fadeMonotonic).toBe(true)
  expect(openReport.slideMonotonic).toBe(true)
  for (const landed of openReport.landed) {
    expect(landed).toMatchObject({ opacity: 1, translateY: 0 })
  }
  for (const below of openReport.below) {
    expect(below.distance).toBeGreaterThan(20)
    expect(below.firstFrameShift).toBeLessThan(0.3)
    expect(below.largestStep).toBeLessThan(0.3)
    expect(below.startsWithinFrames).toBeLessThanOrEqual(2)
    expect(below.stillFrames).toBe(0)
    expect(below.settled).toBeLessThan(0.5)
  }
  expect(cardTimings).toEqual({
    resting: { duration: '0.11s, 0.11s, 0.11s, 0.2s', linearEasing: true },
    selected: { duration: '0.16s, 0.16s, 0.16s, 0.2s', linearEasing: true }
  })
  expect(reducedClose).toEqual({ animations: 0, copies: 0 })
  expect(reducedOpen).toEqual({ animations: 0 })
  expect(grow.firstWidth).toBeLessThan(0.3)
  expect(grow.monotonic).toBe(true)
  expect(grow.growingFrames).toBeGreaterThan(4)
  expect(grow.doneByMs).toBeLessThan(240)
  expect(grow.buttonMoves).toBeGreaterThan(4)
  expect(shrink.firstGhostWidth).toBeGreaterThan(0.75)
  expect(shrink.monotonic).toBe(true)
  expect(shrink.paintedFrames).toBeGreaterThan(4)
  expect(shrink.goneBy).toBeLessThan(220)
  expect(shrink.slotsExcludeCopy).toBe(true)
  expect(endFade.scrollable).toBe(true)
  expect(endFade.mask).toBe(true)
  for (const sample of endFade.samples) {
    expect(sample.strength).toBeCloseTo(Math.min(1, sample.scrollTop / 14), 3)
  }
  expect(endFade.samples[0]).toEqual({ scrollTop: 0, strength: 0 })
  expect(endFade.samples.some((sample) => sample.strength > 0 && sample.strength < 1)).toBe(true)
  expect(endFade.samples.at(-1)).toEqual({ scrollTop: 40, strength: 1 })
})
