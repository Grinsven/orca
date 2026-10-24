// @vitest-environment happy-dom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordElementAnimations,
  stubReducedMotion,
  type RecordedAnimation
} from '@/fork/diri-motion/motion-test-animations'
import { getTabStripSlots, readTabStripSlotIds } from './tab-strip-slot-geometry'
import { useTabStripMotion } from './use-tab-strip-motion'

function Strip({
  tabs,
  worktreeId = 'wt',
  dragging = false
}: {
  tabs: string[]
  worktreeId?: string
  dragging?: boolean
}) {
  const tabStripRef = useRef<HTMLDivElement>(null)
  useTabStripMotion({
    tabStripRef,
    layoutKey: tabs.join('|'),
    worktreeId,
    groupId: 'g',
    isTabDragActive: dragging
  })
  return (
    <div ref={tabStripRef} data-testid="strip">
      {tabs.map((tab) => (
        <div key={tab} data-tab-strip-slot={tab}>
          <div data-tab-id={tab} data-testid="sortable-tab" id={`tab-${tab}`}>
            {tab}
          </div>
        </div>
      ))}
    </div>
  )
}

let root: Root
let container: HTMLDivElement
let animations: RecordedAnimation[] = []
let now = 0

function render(tabs: string[], options: { dragging?: boolean; worktreeId?: string } = {}) {
  act(() =>
    root.render(
      <Strip tabs={tabs} worktreeId={options.worktreeId} dragging={options.dragging ?? false} />
    )
  )
}

function strip(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="strip"]')
  if (!element) {
    throw new Error('no strip')
  }
  return element
}

function childOrder(): string[] {
  return Array.from(strip().children).map((child) =>
    child.hasAttribute('data-tab-strip-ghost')
      ? `ghost:${child.textContent}`
      : (child.getAttribute('data-tab-strip-slot') ?? '')
  )
}

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  animations = recordElementAnimations()
  stubReducedMotion(false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('tab strip motion', () => {
  it('lands at once on first paint', () => {
    render(['a', 'b'])
    expect(animations).toHaveLength(0)
  })

  it('grows a new tab from width 0 to its own width over 180 ms on ease3', () => {
    render(['a', 'b'])
    render(['a', 'b', 'c'])
    expect(animations).toHaveLength(1)
    const [grow] = animations
    expect(grow?.element.getAttribute('data-tab-strip-slot')).toBe('c')
    expect(grow?.keyframes).toEqual([{ width: '0px', minWidth: '0px', offset: 0 }])
    expect(grow?.options).toEqual({ duration: 180, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' })
    expect(grow?.element.hasAttribute('data-tab-motion')).toBe(true)
    grow?.finish()
    expect(grow?.element.hasAttribute('data-tab-motion')).toBe(false)
  })

  it('keeps a closed tab painted in place while it shrinks to 0 over 150 ms', () => {
    render(['a', 'b', 'c'])
    render(['a', 'c'])
    expect(childOrder()).toEqual(['a', 'ghost:b', 'c'])
    const [shrink] = animations
    expect(shrink?.keyframes).toEqual([{ width: '0px', minWidth: '0px', offset: 1 }])
    expect(shrink?.options).toMatchObject({ duration: 150, fill: 'forwards' })
    // The copy answers no lookup meant for a live tab.
    expect([...readTabStripSlotIds(strip())]).toEqual(['a', 'c'])
    expect(getTabStripSlots(strip())).toHaveLength(2)
    expect(strip().querySelectorAll('[data-testid="sortable-tab"]')).toHaveLength(2)
    expect(strip().querySelector('[data-tab-id="b"]')).toBeNull()
    shrink?.finish()
    expect(childOrder()).toEqual(['a', 'c'])
  })

  it('shrinks the last tab in place after the others', () => {
    render(['a', 'b'])
    render(['a'])
    expect(childOrder()).toEqual(['a', 'ghost:b'])
  })

  it('treats a tab replaced in place as a swap, not a close and an open', () => {
    render(['a', 'preview-1', 'c'])
    render(['a', 'preview-2', 'c'])
    expect(animations).toHaveLength(0)
    expect(childOrder()).toEqual(['a', 'preview-2', 'c'])
  })

  it('lands at once during a drag and just after the drop', () => {
    render(['a', 'b'])
    render(['a', 'b'], { dragging: true })
    render(['a'], { dragging: true })
    render(['a', 'c'])
    expect(animations).toHaveLength(0)
    now += 400
    render(['a', 'c', 'd'])
    expect(animations).toHaveLength(1)
  })

  it('lands at once when the strip switches worktree', () => {
    render(['a', 'b'])
    render(['x', 'y', 'z'], { worktreeId: 'other' })
    expect(animations).toHaveLength(0)
    expect(childOrder()).toEqual(['x', 'y', 'z'])
  })

  it('lands at once in a strip that scrolls, where reveals measure the slots', () => {
    render(['a', 'b', 'c'])
    Object.defineProperty(strip(), 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(strip(), 'clientWidth', { configurable: true, value: 400 })
    render(['a', 'b', 'c', 'd'])
    render(['a', 'c', 'd'])
    expect(animations).toHaveLength(0)
    expect(childOrder()).toEqual(['a', 'c', 'd'])
  })

  it('lands at once under Reduce Motion', () => {
    stubReducedMotion(true)
    render(['a', 'b'])
    render(['a', 'b', 'c'])
    render(['a', 'c'])
    expect(animations).toHaveLength(0)
    expect(childOrder()).toEqual(['a', 'c'])
  })
})
