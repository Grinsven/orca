// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import {
  recordElementAnimations,
  stubReducedMotion,
  type RecordedAnimation
} from '@/fork/diri-motion/motion-test-animations'
import { getRenderRowKey, type RenderRow } from '../listing/render-row'
import { createSidebarFoldMotion, type SidebarFoldMotion } from './fold-motion'
import { getSidebarRowIdentityKeys } from './use-row-removal-animation'

const ROW = 40

function header(key: string): RenderRow {
  return { type: 'header', key, label: key, count: 1, tone: 'text-foreground' }
}

function row(id: string): RenderRow {
  return { type: 'pending-creation', key: id, creationId: id, repo: undefined }
}

const CLOSED = [header('a'), header('b'), row('b1')]
const OPEN = [header('a'), row('a1'), row('a2'), row('a3'), header('b'), row('b1')]

/** A sidebar list stand-in: one 40 px slot per row, all mounted, laid out top to bottom. */
function createList() {
  const scrollElement = document.createElement('div')
  const overlayHost = document.createElement('div')
  document.body.append(overlayHost, scrollElement)
  const wrappers = new Map<string, HTMLElement>()
  const tops = new WeakMap<Element, number>()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === overlayHost) {
      return new DOMRect(0, 0, 200, 400)
    }
    const top = tops.get(this)
    return top === undefined ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, top, 200, ROW)
  })
  const content = (key: string): HTMLElement => {
    const element = wrappers.get(key)?.firstElementChild
    if (!(element instanceof HTMLElement)) {
      throw new Error(`no row ${key}`)
    }
    return element
  }
  const render = (rows: readonly RenderRow[], extraHeightAfter?: string) => {
    let start = 0
    const virtualItems: VirtualItem[] = []
    const keys = new Set<string>()
    rows.forEach((renderRow, index) => {
      const key = getRenderRowKey(renderRow)
      keys.add(key)
      let wrapper = wrappers.get(key)
      if (!wrapper) {
        wrapper = document.createElement('div')
        wrapper.setAttribute('data-worktree-virtual-row', '')
        wrapper.setAttribute('data-worktree-virtual-row-key', key)
        const rowContent = document.createElement('div')
        rowContent.id = `option-${key}`
        wrapper.append(rowContent)
        wrappers.set(key, wrapper)
      }
      scrollElement.append(wrapper)
      tops.set(wrapper, start)
      tops.set(content(key), start)
      const size = key === extraHeightAfter ? ROW * 2 : ROW
      virtualItems.push({ key, index, start, end: start + size, size, lane: 0 })
      start += size
    })
    wrappers.forEach((wrapper, key) => {
      if (!keys.has(key)) {
        wrapper.remove()
        wrappers.delete(key)
      }
    })
    return {
      scrollElement,
      overlayHost,
      renderRows: rows,
      rowIdentityKeys: getSidebarRowIdentityKeys(rows),
      virtualItems,
      measurements: virtualItems,
      rekeyedRowKeys: new Map<string, string>(),
      dragActive: false
    }
  }
  return { scrollElement, overlayHost, render, content }
}

let now = 0
let animations: RecordedAnimation[] = []

function animationOn(element: Element): RecordedAnimation | undefined {
  return animations.findLast((entry) => entry.element === element && !entry.cancelled)
}

function toggle(
  motion: SidebarFoldMotion,
  list: ReturnType<typeof createList>,
  direction: 'open' | 'close',
  rows: readonly RenderRow[]
): void {
  motion.begin({
    direction,
    scrollElement: list.scrollElement,
    overlayHost: list.overlayHost,
    measurements: list.render(direction === 'open' ? CLOSED : OPEN).virtualItems
  })
  motion.commit(list.render(rows))
}

function advance(ms: number): void {
  now += ms
  for (const entry of animations) {
    entry.currentTime += ms
  }
}

beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  animations = recordElementAnimations()
  stubReducedMotion(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('sidebar group fold', () => {
  it('opens: rows fade in from 6 px above, about 22 ms apart, and rows below glide down', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    toggle(motion, list, 'open', OPEN)

    const reveals = ['pending:a1', 'pending:a2', 'pending:a3'].map((key) =>
      animationOn(list.content(key))
    )
    expect(reveals.map((entry) => entry?.keyframes)).toEqual([
      [{ translate: '0 -6px', opacity: 0, offset: 0 }],
      [{ translate: '0 -6px', opacity: 0, offset: 0 }],
      [{ translate: '0 -6px', opacity: 0, offset: 0 }]
    ])
    expect(reveals.map((entry) => Math.round(Number(entry?.options.delay) * 10) / 10)).toEqual([
      0, 21.9, 43.8
    ])
    // Every row lands at 300 ms: duration plus delay.
    for (const entry of reveals) {
      expect(Number(entry?.options.delay) + Number(entry?.options.duration)).toBeCloseTo(300, 6)
      expect(entry?.options.easing).toBe('cubic-bezier(0.33, 1, 0.68, 1)')
      expect(entry?.options.fill).toBe('backwards')
    }
    const below = animationOn(list.content('hdr:b'))
    expect(below?.keyframes).toEqual([{ translate: '0 -120px', opacity: 1, offset: 0 }])
    expect(below?.options.duration).toBe(300)
    expect(animationOn(list.content('hdr:a'))).toBeUndefined()
  })

  it('closes: copies of its rows stay painted, fade out and rise 6 px over 180 ms', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(OPEN))
    toggle(motion, list, 'close', CLOSED)

    const frames = Array.from(list.overlayHost.children)
    expect(frames.map((frame) => (frame instanceof HTMLElement ? frame.style.top : ''))).toEqual([
      '40px',
      '80px',
      '120px'
    ])
    for (const frame of frames) {
      const entry = animationOn(frame)
      expect(entry?.keyframes).toEqual([
        { translate: '0 0px', opacity: 1 },
        { translate: '0 -6px', opacity: 0 }
      ])
      expect(entry?.options.duration).toBe(180)
      expect(entry?.options.delay).toBe(0)
      expect(frame.querySelector('[id]')).toBeNull()
    }
    const below = animationOn(list.content('hdr:b'))
    expect(below?.keyframes).toEqual([{ translate: '0 120px', opacity: 1, offset: 0 }])
    expect(below?.options.duration).toBe(180)

    advance(180)
    frames.forEach((frame) => animationOn(frame)?.finish())
    expect(list.overlayHost.children).toHaveLength(0)
  })

  it('reversing mid-open starts the close from where each row is drawn', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    toggle(motion, list, 'open', OPEN)
    advance(150)
    toggle(motion, list, 'close', CLOSED)

    const [first, , third] = Array.from(list.overlayHost.children).map((frame) =>
      animationOn(frame)
    )
    expect(first?.keyframes[0]?.translate).toBe('0 -0.75px')
    expect(first?.keyframes[0]?.opacity).toBeCloseTo(0.875, 6)
    expect(third?.keyframes[0]?.opacity).toBeCloseTo(1 - (1 - 106.2 / 256.2) ** 3, 6)
    // Row b was 15 px short of rest, moving down; it now glides up from there.
    expect(animationOn(list.content('hdr:b'))?.keyframes).toEqual([
      { translate: '0 105px', opacity: 1, offset: 0 }
    ])
  })

  it('reversing mid-close starts the open from where the copies are drawn', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(OPEN))
    toggle(motion, list, 'close', CLOSED)
    advance(90)
    toggle(motion, list, 'open', OPEN)

    expect(list.overlayHost.children).toHaveLength(0)
    const reveal = animationOn(list.content('pending:a1'))
    expect(reveal?.keyframes[0]?.translate).toBe('0 -5.25px')
    expect(reveal?.keyframes[0]?.opacity).toBeCloseTo(0.125, 6)
  })

  it('lands at once under Reduce Motion', () => {
    stubReducedMotion(true)
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    toggle(motion, list, 'open', OPEN)
    toggle(motion, list, 'close', CLOSED)
    expect(animations).toHaveLength(0)
    expect(list.overlayHost.children).toHaveLength(0)
  })

  it('does not fold rows added by data, and only glides rows that lost a neighbour', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    motion.commit(list.render(OPEN))
    expect(animations).toHaveLength(0)
    motion.commit(list.render(CLOSED))
    expect(animations.map((entry) => entry.element)).toEqual([
      list.content('hdr:b'),
      list.content('pending:b1')
    ])
    expect(animations.map((entry) => entry.options.duration)).toEqual([180, 180])
    expect(list.overlayHost.children).toHaveLength(0)
  })

  it('lands at once during a drag', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    motion.begin({
      direction: 'open',
      scrollElement: list.scrollElement,
      overlayHost: list.overlayHost,
      measurements: list.render(CLOSED).virtualItems
    })
    motion.commit({ ...list.render(OPEN), dragActive: true })
    expect(animations).toHaveLength(0)
  })

  it('keeps rows continuous when an opened row measures taller mid-fold', () => {
    const list = createList()
    const motion = createSidebarFoldMotion()
    motion.commit(list.render(CLOSED))
    toggle(motion, list, 'open', OPEN)
    advance(100)
    motion.commit(list.render(OPEN, 'pending:a2'))

    const below = animationOn(list.content('hdr:b'))
    // At 100 ms the row was at -120 * (1 - ease3(1/3)); it moved 40 px down underneath.
    const drawn = -120 * (1 - (1 - (1 - 1 / 3) ** 3))
    const translate = String(below?.keyframes[0]?.translate ?? '')
    expect(Number.parseFloat(translate.split(' ')[1] ?? '')).toBeCloseTo(drawn - 40, 6)
    expect(Number(below?.options.duration)).toBeCloseTo(200, 6)
    const delayedRow = animationOn(list.content('pending:a3'))
    expect(delayedRow?.options.delay).toBe(0)
  })
})
