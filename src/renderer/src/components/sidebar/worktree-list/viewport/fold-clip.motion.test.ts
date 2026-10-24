import { describe, expect, it } from 'vitest'
import { foldClipKeyframes, foldVisibleHeight } from './fold-clip'

/** The clip's bottom inset at eased progress `p`, read off the keyframes the way WAAPI does. */
function insetAt(keyframes: Keyframe[], p: number): number {
  const stops = keyframes.map((keyframe) => ({
    offset: Number(keyframe.offset),
    bottom: Number.parseFloat(String(keyframe.clipPath).split(' ')[2] ?? '')
  }))
  const after = stops.findIndex((stop) => stop.offset >= p)
  const end = stops[after]
  const start = stops[Math.max(0, after - 1)]
  if (!end || !start || end.offset === start.offset) {
    return end?.bottom ?? stops.at(-1)?.bottom ?? 0
  }
  return (
    start.bottom + ((end.bottom - start.bottom) * (p - start.offset)) / (end.offset - start.offset)
  )
}

// A group of rows laid out with 6 px gaps; the row below starts where the group ends.
const ROWS = [
  { y: 0, h: 40 },
  { y: 46, h: 58 },
  { y: 110, h: 28 },
  { y: 144, h: 40 }
]
const GROUP_HEIGHT = 190
const PROGRESSES = [0, 0.05, 0.2, 0.33, 0.5, 0.61, 0.75, 0.9, 1]

function expectRowsTrackEdge(fromPx: number, toPx: number): void {
  for (const { y, h } of ROWS) {
    const keyframes = foldClipKeyframes(y, h, fromPx, toPx)
    expect(keyframes[0]?.offset).toBe(0)
    expect(keyframes.at(-1)?.offset).toBe(1)
    for (const p of PROGRESSES) {
      const edge = fromPx + (toPx - fromPx) * p
      const visibleContent = Math.min(h, h - insetAt(keyframes, p))
      expect(visibleContent).toBeCloseTo(Math.min(h, Math.max(0, edge - y)), 6)
      // Nothing of the row, its shadow included, shows below the edge.
      expect(y + h - insetAt(keyframes, p)).toBeLessThanOrEqual(Math.max(y, edge) + 1e-6)
    }
  }
}

describe('fold clip at the moving edge', () => {
  it('opens: each row shows only the part above top + H * ease3(t)', () => {
    expectRowsTrackEdge(0, GROUP_HEIGHT)
  })

  it('closes: each copy shows only the part above top + H * (1 - ease3(t))', () => {
    expectRowsTrackEdge(GROUP_HEIGHT, 0)
  })

  it('reverses from the height the edge had reached', () => {
    expectRowsTrackEdge(72.5, GROUP_HEIGHT)
    expectRowsTrackEdge(131.25, 0)
  })

  it('never shows a row before the edge reaches it, and all of it once passed', () => {
    expect(foldVisibleHeight(46, 58, 30)).toBe(0)
    expect(foldVisibleHeight(46, 58, 60)).toBe(14)
    expect(foldVisibleHeight(46, 58, 500)).toBe(58)
    expect(foldClipKeyframes(46, 58, 0, GROUP_HEIGHT)).toEqual([
      { offset: 0, clipPath: 'inset(-64px -64px 58px -64px)' },
      { offset: 46 / GROUP_HEIGHT, clipPath: 'inset(-64px -64px 58px -64px)' },
      { offset: 110 / GROUP_HEIGHT, clipPath: 'inset(-64px -64px -6px -64px)' },
      { offset: 1, clipPath: 'inset(-64px -64px -6px -64px)' }
    ])
  })
})
