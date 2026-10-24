import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_ROW_MOTION,
  buildListEndFadeMask,
  CARD_HOVER_OUT_EASING,
  CARD_MOTION,
  CARD_SELECTION_IN_EASING,
  cardHoverFill,
  cardSelectionFill,
  ease3,
  EASE3_CSS,
  FOLD_MOTION,
  foldCloseRemaining,
  foldOpenProgress,
  foldRowDelayMs,
  LIST_END_FADE,
  listTopFadeStrength,
  SIDEBAR_CARD_MOTION_VARS,
  spring,
  TAB_MOTION,
  tabGrowWidth,
  tabShrinkWidth,
  toLinearEasing
} from './motion'

const samples = (count: number): number[] =>
  Array.from({ length: count + 1 }, (_, index) => index / count)

describe('curves', () => {
  it('ease3 is 1 - (1 - t)^3, clamped, with its CSS cubic-bezier', () => {
    expect(ease3(0)).toBe(0)
    expect(ease3(0.5)).toBeCloseTo(0.875, 6)
    expect(ease3(1)).toBe(1)
    expect(ease3(-1)).toBe(0)
    expect(ease3(2)).toBe(1)
    expect(EASE3_CSS).toBe('cubic-bezier(0.33, 1, 0.68, 1)')
  })

  it('spring lands exactly on 1 and never overshoots', () => {
    for (const k of [CARD_MOTION.hoverSpring, CARD_MOTION.selectionSpring]) {
      expect(spring(k, 0)).toBe(0)
      expect(spring(k, 1)).toBe(1)
      let last = 0
      for (const p of samples(200)) {
        const value = spring(k, p)
        expect(value).toBeGreaterThanOrEqual(last - 1e-12)
        expect(value).toBeLessThanOrEqual(1)
        last = value
      }
    }
    expect(CARD_MOTION.selectionSpring).toBeCloseTo(6.317, 3)
  })

  it('samples a curve into a CSS linear() easing', () => {
    const easing = toLinearEasing((p) => p * p, 4)
    expect(easing).toBe('linear(0 0%, 0.0625 25%, 0.25 50%, 0.5625 75%, 1 100%)')
    expect(CARD_HOVER_OUT_EASING.startsWith('linear(0 0%, ')).toBe(true)
    expect(CARD_HOVER_OUT_EASING.endsWith(', 1 100%)')).toBe(true)
    expect(CARD_SELECTION_IN_EASING).toContain(`${Math.round(spring(6.317, 0.5) * 1e4) / 1e4}`)
  })
})

describe('group open and close', () => {
  it('reveals the first row on ease3 over 300 ms', () => {
    const at = [0, 8, 50, 100, 150, 300].map((ms) => foldOpenProgress(ms))
    expect(at[0]).toBe(0)
    expect(at[1]).toBeCloseTo(0.078, 3)
    expect(at[2]).toBeCloseTo(0.421, 3)
    expect(at[3]).toBeCloseTo(0.704, 3)
    expect(at[4]).toBeCloseTo(0.875, 3)
    expect(at[5]).toBe(1)
  })

  it('staggers rows about 22 ms apart, capped at 108 ms, all ending at 300 ms', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map(foldRowDelayMs)
    expect(delays.map((delay) => Math.round(delay))).toEqual([0, 22, 44, 66, 88, 108, 108, 108])
    for (let index = 0; index < 8; index++) {
      expect(foldOpenProgress(foldRowDelayMs(index), index)).toBe(0)
      expect(foldOpenProgress(FOLD_MOTION.openMs, index)).toBe(1)
    }
  })

  it('closes on ease3 over 180 ms', () => {
    expect(foldCloseRemaining(0)).toBe(1)
    expect(foldCloseRemaining(45)).toBeCloseTo(0.422, 3)
    expect(foldCloseRemaining(90)).toBeCloseTo(0.125, 3)
    expect(foldCloseRemaining(180)).toBe(0)
    expect(FOLD_MOTION.offsetPx).toBe(6)
  })
})

describe('cards', () => {
  it('hover fill fades out as 1 - spring(3, p) over 110 ms', () => {
    expect(cardHoverFill(0)).toBe(1)
    expect(cardHoverFill(55)).toBeCloseTo(1 - spring(3, 0.5), 9)
    expect(cardHoverFill(55)).toBeCloseTo(0.448, 3)
    expect(cardHoverFill(110)).toBe(0)
  })

  it('selection fill springs in over 160 ms at stiffness about 6.32', () => {
    expect(cardSelectionFill(0)).toBe(0)
    expect(cardSelectionFill(80)).toBeCloseTo(0.834, 3)
    expect(cardSelectionFill(160)).toBe(1)
  })

  it('feeds the fork stylesheet its durations and curves', () => {
    expect(SIDEBAR_CARD_MOTION_VARS).toEqual({
      '--worktree-card-hover-out-duration': '110ms',
      '--worktree-card-hover-out-easing': CARD_HOVER_OUT_EASING,
      '--worktree-card-selection-in-duration': '160ms',
      '--worktree-card-selection-in-easing': CARD_SELECTION_IN_EASING
    })
    const css = readFileSync(join(__dirname, 'diri-motion.css'), 'utf8')
    for (const name of Object.keys(SIDEBAR_CARD_MOTION_VARS)) {
      expect(css).toContain(`var(${name})`)
    }
    expect(css).toContain('.worktree-sidebar-card-hover:hover {\n  transition-duration: 0s, 0s, 0s')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('agent rows and tabs', () => {
  it('times agent rows in at 220 ms and out at 200 ms', () => {
    expect(AGENT_ROW_MOTION).toEqual({ inMs: 220, outMs: 200 })
  })

  it('grows a new tab from 0 over 180 ms and shrinks a closed one over 150 ms', () => {
    expect(TAB_MOTION).toEqual({ growMs: 180, shrinkMs: 150 })
    expect(tabGrowWidth(0, 180)).toBe(0)
    expect(tabGrowWidth(90, 180)).toBeCloseTo(157.5, 6)
    expect(tabGrowWidth(180, 180)).toBe(180)
    expect(tabShrinkWidth(0, 180)).toBe(180)
    expect(tabShrinkWidth(75, 180)).toBeCloseTo(22.5, 6)
    expect(tabShrinkWidth(150, 180)).toBe(0)
  })
})

describe('list end fade', () => {
  it('ramps the top fade in over the first 14 px of scroll', () => {
    expect(LIST_END_FADE).toEqual({ fadePx: 28, topRampPx: 14 })
    expect(listTopFadeStrength(0)).toBe(0)
    expect(listTopFadeStrength(7)).toBe(0.5)
    expect(listTopFadeStrength(14)).toBe(1)
    expect(listTopFadeStrength(400)).toBe(1)
  })

  it('masks 28 px at each end below any pinned headers', () => {
    expect(buildListEndFadeMask()).toBe(
      'linear-gradient(to bottom, black var(--list-fade-inset, 0px), ' +
        'rgb(0 0 0 / calc(1 - var(--list-top-fade, 0))) var(--list-fade-inset, 0px), ' +
        'black calc(var(--list-fade-inset, 0px) + 28px), black calc(100% - 28px), transparent 100%)'
    )
  })
})
