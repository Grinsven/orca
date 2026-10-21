import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CDPSession, Page } from '@stablyai/playwright-test'

/** `workMs`: main-thread time from the frame's start until the frame's update finished: every
 * animation frame callback (xterm's render, the glide's paint) plus style, layout and paint. */
export type GlideFrame = {
  t: number
  workMs: number
  visible: boolean
  x: number | null
  opacity: number
}

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __cursorGlideRecord?: { frames: GlideFrame[]; running: boolean; cellWidth: number }
  }
}

/** Samples the overlay cursor every animation frame until stopped. */
export async function startGlideRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: GlideFrame[] = []
    const record = { frames, running: true, cellWidth: 0 }
    window.__cursorGlideRecord = record
    // A message posted during the frame runs as the first task after that frame's update.
    const channel = new MessageChannel()
    const pending: { frame: GlideFrame; t: number }[] = []
    channel.port1.onmessage = () => {
      const entry = pending.shift()
      if (entry) {
        entry.frame.workMs = performance.now() - entry.t
      }
    }
    const sample = (t: number): void => {
      const overlay = document.querySelector<HTMLElement>('.xterm-screen .orca-cursor-glide')
      const match = overlay?.style.transform.match(/translate3d\(([-\d.]+)px/)
      if (overlay && record.cellWidth === 0) {
        record.cellWidth = Number.parseFloat(overlay.style.width) || 0
      }
      const frame: GlideFrame = {
        t,
        workMs: 0,
        visible: overlay?.dataset.visible === 'true',
        x: match ? Number(match[1]) : null,
        opacity: overlay ? Number(overlay.style.opacity || '1') : 1
      }
      record.frames.push(frame)
      pending.push({ frame, t })
      channel.port2.postMessage(null)
      if (record.running) {
        requestAnimationFrame(sample)
      } else {
        channel.port1.close()
      }
    }
    requestAnimationFrame(sample)
  })
}

export async function stopGlideRecorder(
  page: Page
): Promise<{ frames: GlideFrame[]; cellWidth: number }> {
  return page.evaluate(() => {
    const record = window.__cursorGlideRecord!
    record.running = false
    return { frames: record.frames, cellWidth: record.cellWidth }
  })
}

export function intervalsOf(frames: readonly GlideFrame[]): number[] {
  return frames.slice(1).map((frame, index) => frame.t - frames[index].t)
}

export function intervalStats(intervals: readonly number[]): {
  frames: number
  p50Ms: number
  p95Ms: number
  maxMs: number
} {
  const sorted = intervals.toSorted((a, b) => a - b)
  const at = (fraction: number): number =>
    sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  const round = (value: number): number => Math.round(value * 100) / 100
  return {
    frames: sorted.length,
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.at(-1) ?? 0)
  }
}

/** Runs of back-to-back frames that showed the moving overlay, one run per glide. */
export function glideFrameIntervals(frames: readonly GlideFrame[]): GlideFrame[][] {
  const runs: GlideFrame[][] = []
  let run: GlideFrame[] = []
  for (const frame of frames) {
    if (frame.visible) {
      run.push(frame)
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) {
    runs.push(run)
  }
  return runs
}

/** Frames where the overlay sat between two cells: the glide in motion. */
export function midGlideFrames(frames: readonly GlideFrame[], cellWidth: number): GlideFrame[] {
  return frames.filter((frame) => {
    if (!frame.visible || frame.x === null || cellWidth <= 0) {
      return false
    }
    const cells = frame.x / cellWidth
    return Math.abs(cells - Math.round(cells)) > 0.02
  })
}

/** Saves every compositor frame CDP hands over, so the glide can be checked frame by frame. */
export async function startScreencast(
  page: Page,
  directory: string
): Promise<{ stop: () => Promise<number> }> {
  await mkdir(directory, { recursive: true })
  const cdp: CDPSession = await page.context().newCDPSession(page)
  let index = 0
  const writes: Promise<void>[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    const name = `frame-${String(index++).padStart(4, '0')}.png`
    writes.push(writeFile(path.join(directory, name), Buffer.from(frame.data, 'base64')))
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  return {
    stop: async () => {
      await cdp.send('Page.stopScreencast')
      await Promise.all(writes)
      await cdp.detach()
      return index
    }
  }
}

/**
 * A stand-in for Claude Code's input box, built from its captured PTY bytes: every keystroke
 * hides the cursor, repaints the input row, parks on the last row, moves to the caret and shows
 * the cursor again.
 */
export const AGENT_INPUT_BOX_SCRIPT = `
const rows = process.stdout.rows || 24
const inputRow = Math.max(3, rows - 4)
let text = ''
const paint = () => process.stdout.write(
  '\\x1b[?25l\\x1b[H\\x1b[' + inputRow + ';1H> ' + text + '\\x1b[K' +
  '\\x1b[' + rows + ';1H\\x1b[' + inputRow + ';' + (3 + text.length) + 'H\\x1b[?25h'
)
process.stdout.write('\\x1b[?1049h\\x1b[2J\\x1b[2;1Hagent box ready')
paint()
process.stdin.setRawMode(true)
process.stdin.on('data', (chunk) => {
  for (const ch of chunk.toString()) {
    if (ch === '\\x03') { process.stdout.write('\\x1b[?1049l'); process.exit(0) }
    text = ch === '\\x7f' ? text.slice(0, -1) : text + ch
  }
  paint()
})
`
