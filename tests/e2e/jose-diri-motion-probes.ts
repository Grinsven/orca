import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'

/** One sidebar row as drawn in a frame: its on-screen top and the fold's opacity and offset. */
export type RowSample = { top: number; opacity: number; translateY: number }

export type FoldFrame = {
  t: number
  rows: Record<string, RowSample | null>
  copies: number[]
  /** Lowest painted pixel of the group's rows and copies, after their clip-path. */
  groupBottom: number | null
  /** Top of the first row under the group, as drawn. */
  belowTop: number | null
}

export type TabFrame = {
  t: number
  slots: { id: string; left: number; width: number }[]
  ghost: number | null
  newTabButtonLeft: number
}

/**
 * Clicks `trigger` and samples the watched virtual rows and the fold overlay every animation
 * frame for `durationMs`. A sample taken in a frame's animation callback is what that frame paints.
 */
export async function recordFold(
  page: Page,
  args: { trigger: string; rows: string[]; group: string[]; below: string; durationMs: number }
): Promise<{
  before: Record<string, RowSample | null>
  frames: FoldFrame[]
  longTasks: { start: number; duration: number }[]
}> {
  return page.evaluate(
    ({ trigger, rows, group, below: belowKey, durationMs }) =>
      new Promise((resolve) => {
        const sampleRow = (key: string) => {
          const row = document.querySelector(`[data-worktree-virtual-row-key="${CSS.escape(key)}"]`)
          const content = row?.firstElementChild
          if (!(content instanceof HTMLElement)) {
            return null
          }
          const style = getComputedStyle(content)
          const translate = style.translate === 'none' ? [] : style.translate.split(' ')
          return {
            top: content.getBoundingClientRect().top,
            opacity: Number(style.opacity),
            translateY: Number.parseFloat(translate[1] ?? '0') || 0
          }
        }
        const contentOf = (key: string) =>
          document.querySelector(`[data-worktree-virtual-row-key="${CSS.escape(key)}"]`)
            ?.firstElementChild ?? null
        // A clip-path inset() keeps the box but hides its bottom; that is where painting ends.
        const paintedBottom = (element: Element) => {
          const rect = element.getBoundingClientRect()
          const clip = getComputedStyle(element).clipPath
          const values = clip.startsWith('inset(')
            ? clip
                .slice(6)
                .split(/[\s)]+/)
                .filter(Boolean)
                .map(Number.parseFloat)
            : []
          const inset = values.length >= 3 ? values[2] : (values[0] ?? 0)
          // Why skip an empty band: a row clipped to nothing paints no pixel at all.
          const visible = rect.height - Math.max(0, inset ?? 0)
          return visible > 0.5 ? rect.top + visible : Number.NEGATIVE_INFINITY
        }
        const copiesNow = () =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-worktree-fold-overlay] > *'))
        const sample = () => {
          const painted = [
            ...group.map(contentOf).filter((element) => element !== null),
            ...copiesNow()
          ].map(paintedBottom)
          return {
            rows: Object.fromEntries(rows.map((key) => [key, sampleRow(key)])),
            copies: copiesNow().map((copy) => Number(getComputedStyle(copy).opacity)),
            groupBottom: painted.some(Number.isFinite) ? Math.max(...painted) : null,
            belowTop: contentOf(belowKey)?.getBoundingClientRect().top ?? null
          }
        }
        const before = sample().rows
        const target = document.querySelector<HTMLElement>(trigger)
        if (!target) {
          throw new Error(`no fold trigger ${trigger}`)
        }
        const clickedAt = performance.now()
        const longTasks: { start: number; duration: number }[] = []
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({ start: entry.startTime - clickedAt, duration: entry.duration })
          }
        })
        observer.observe({ type: 'longtask' })
        target.click()
        const startedAt = performance.now()
        const frames: FoldFrame[] = []
        const tick = (now: number) => {
          frames.push({ t: now - startedAt, ...sample() })
          if (now - startedAt < durationMs) {
            requestAnimationFrame(tick)
          } else {
            observer.disconnect()
            resolve({ before, frames, longTasks })
          }
        }
        requestAnimationFrame(tick)
      }),
    args
  )
}

/** Runs `action` (a store call by name) and samples the tab strip every frame. */
export async function recordTabStrip(
  page: Page,
  args: { action: 'open' | 'close'; worktreeId: string; tabId?: string; durationMs: number }
): Promise<{ createdId: string | null; frames: TabFrame[] }> {
  return page.evaluate(
    ({ action, worktreeId, tabId, durationMs }) =>
      new Promise((resolve) => {
        const strip = document.querySelector<HTMLElement>('.terminal-tab-strip')
        const newTab = document.querySelector<HTMLElement>('button[aria-label="New tab"]')
        if (!strip || !newTab) {
          throw new Error('no tab strip')
        }
        const sample = (): Omit<TabFrame, 't'> => {
          const ghost = strip.querySelector<HTMLElement>(':scope > [data-tab-strip-ghost]')
          return {
            slots: Array.from(
              strip.querySelectorAll<HTMLElement>(
                ':scope > [data-tab-strip-slot]:not([data-tab-strip-ghost])'
              ),
              (slot) => {
                const rect = slot.getBoundingClientRect()
                return { id: slot.dataset.tabStripSlot ?? '', left: rect.left, width: rect.width }
              }
            ),
            ghost: ghost ? ghost.getBoundingClientRect().width : null,
            newTabButtonLeft: newTab.getBoundingClientRect().left
          }
        }
        const state = window.__store!.getState()
        let createdId: string | null = null
        if (action === 'open') {
          createdId = state.createTab(worktreeId, undefined, undefined, { activate: true }).id
        } else if (tabId) {
          state.closeTab(tabId)
        }
        const startedAt = performance.now()
        const frames: TabFrame[] = []
        const tick = (now: number) => {
          frames.push({ t: now - startedAt, ...sample() })
          if (now - startedAt < durationMs) {
            requestAnimationFrame(tick)
          } else {
            resolve({ createdId, frames })
          }
        }
        requestAnimationFrame(tick)
      }),
    args
  )
}

/** Holds every running sidebar animation at `ms` from its start so a capture shows that moment. */
export async function seekSidebarAnimations(page: Page, ms: number | 'finish'): Promise<number> {
  return page.evaluate((at) => {
    const sidebar = document.querySelector('[data-worktree-sidebar-container]')
    let count = 0
    for (const animation of document.getAnimations()) {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
      if (
        !sidebar ||
        !target ||
        !sidebar.contains(target) ||
        animation instanceof CSSTransition ||
        animation instanceof CSSAnimation
      ) {
        continue
      }
      count++
      if (at === 'finish') {
        animation.finish()
      } else {
        animation.pause()
        animation.currentTime = at
      }
    }
    return count
  }, ms)
}

export async function captureSidebar(page: Page, directory: string, name: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const clip = await page.evaluate(() => {
    const rect = document
      .querySelector('[data-worktree-sidebar-container]')
      ?.getBoundingClientRect()
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })
  const file = path.join(directory, name)
  const buffer = await page.screenshot({ clip: clip ?? undefined, animations: 'allow' })
  await writeFile(file, buffer)
  return file
}

export function nextFrame(page: Page, frames = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    frames
  )
}
