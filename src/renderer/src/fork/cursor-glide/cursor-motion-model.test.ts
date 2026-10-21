import { describe, expect, it } from 'vitest'
import {
  CALM_BLINK,
  CursorMotionModel,
  calmBlinkOpacity,
  calmBlinkSchedule,
  easeOutCubic,
  shouldGlide
} from './cursor-motion-model'

const typed = {
  previous: { col: 4, row: 2 },
  next: { col: 5, row: 2 },
  rowsDamaged: 1,
  sinceOutputMs: 120,
  sinceKeystrokeMs: 10
}

describe('shouldGlide', () => {
  it('glides a short move the user caused', () => {
    expect(shouldGlide(typed)).toBe(true)
    expect(shouldGlide({ ...typed, next: { col: 12, row: 4 } })).toBe(true)
  })

  it('snaps long moves, redraws, streams and moves nobody typed', () => {
    expect(shouldGlide({ ...typed, next: { col: 13, row: 2 } })).toBe(false)
    expect(shouldGlide({ ...typed, next: { col: 4, row: 5 } })).toBe(false)
    expect(shouldGlide({ ...typed, rowsDamaged: 3 })).toBe(false)
    expect(shouldGlide({ ...typed, sinceOutputMs: 19 })).toBe(false)
    expect(shouldGlide({ ...typed, sinceKeystrokeMs: 351 })).toBe(false)
    expect(shouldGlide({ ...typed, sinceKeystrokeMs: null })).toBe(false)
    expect(shouldGlide({ ...typed, next: typed.previous })).toBe(false)
  })

  it('treats the first output after a quiet spell as an echo', () => {
    expect(shouldGlide({ ...typed, sinceOutputMs: null })).toBe(true)
  })
})

describe('calm blink', () => {
  it('holds solid while in use, then fades between the floor and full', () => {
    expect(calmBlinkOpacity(0)).toBe(1)
    expect(calmBlinkOpacity(499)).toBe(1)
    expect(calmBlinkOpacity(600)).toBeCloseTo(CALM_BLINK.floor + (1 - CALM_BLINK.floor) * 0.5)
    expect(calmBlinkOpacity(500 + 250)).toBe(CALM_BLINK.floor)
    expect(calmBlinkOpacity(500 + 900)).toBe(1)
  })

  it('never drops below 28 percent and rests after ten cycles', () => {
    for (let idle = 0; idle < 20_000; idle += 7) {
      expect(calmBlinkOpacity(idle)).toBeGreaterThanOrEqual(0.28)
    }
    expect(calmBlinkOpacity(500 + 12_000)).toBe(1)
    expect(calmBlinkSchedule(500 + 12_000 - 500)).toEqual({ kind: 'rest' })
  })

  it('asks for frames only during fades and sleeps through holds', () => {
    expect(calmBlinkSchedule(100)).toEqual({ kind: 'after', ms: 400 })
    expect(calmBlinkSchedule(550)).toEqual({ kind: 'frame' })
    expect(calmBlinkSchedule(800)).toEqual({ kind: 'after', ms: 200 })
    expect(calmBlinkSchedule(1050)).toEqual({ kind: 'frame' })
    expect(calmBlinkSchedule(1300)).toEqual({ kind: 'after', ms: 400 })
  })
})

describe('CursorMotionModel', () => {
  it('glides a typed character over 80 ms with a cubic ease-out, then rests', () => {
    const model = new CursorMotionModel()
    model.noteKeystroke(1000)
    model.noteUpdate(
      {
        previous: { col: 4, row: 2 },
        next: { col: 5, row: 2 },
        rowsDamaged: 1,
        touchesCursorRow: true
      },
      1010
    )
    const start = model.sample({ col: 5, row: 2 }, 1010, false)
    expect(start.offsetCols).toBeCloseTo(-1)
    expect(start.schedule).toEqual({ kind: 'frame' })
    const middle = model.sample({ col: 5, row: 2 }, 1050, false)
    expect(middle.offsetCols).toBeCloseTo(-(1 - easeOutCubic(0.5)))
    const end = model.sample({ col: 5, row: 2 }, 1090, false)
    expect(end).toEqual({ opacity: 1, offsetCols: 0, offsetRows: 0, schedule: { kind: 'rest' } })
  })

  it('retargets a held key from where the block is, not from the last cell', () => {
    const model = new CursorMotionModel()
    const move = (from: number, to: number, at: number): void =>
      model.noteUpdate(
        {
          previous: { col: from, row: 0 },
          next: { col: to, row: 0 },
          rowsDamaged: 1,
          touchesCursorRow: true
        },
        at
      )
    model.noteKeystroke(0)
    move(0, 1, 0)
    model.noteKeystroke(30)
    move(1, 2, 30)
    const frame = model.sample({ col: 2, row: 0 }, 30, false)
    // At 30 ms the first glide had covered most but not all of its cell.
    expect(frame.offsetCols).toBeCloseTo(easeOutCubic(30 / 80) - 2)
    expect(frame.offsetCols).toBeGreaterThan(-2)
  })

  it('snaps when the cursor is hidden, the move is not typed, or the cell changed', () => {
    const model = new CursorMotionModel()
    model.noteUpdate(
      {
        previous: { col: 0, row: 0 },
        next: { col: 1, row: 0 },
        rowsDamaged: 1,
        touchesCursorRow: true
      },
      0
    )
    expect(model.isGliding(10)).toBe(false)
    model.noteKeystroke(100)
    model.noteUpdate(
      {
        previous: { col: 1, row: 0 },
        next: { col: 2, row: 0 },
        rowsDamaged: 1,
        touchesCursorRow: true
      },
      110
    )
    expect(model.isGliding(120)).toBe(true)
    expect(model.sample({ col: 9, row: 0 }, 120, false).offsetCols).toBe(0)
    model.noteUpdate(
      { previous: { col: 2, row: 0 }, next: null, rowsDamaged: 1, touchesCursorRow: true },
      130
    )
    expect(model.isGliding(131)).toBe(false)
  })

  it('stays solid with blink off and holds the blink solid after activity', () => {
    const model = new CursorMotionModel()
    model.noteActivity(0)
    expect(model.sample({ col: 0, row: 0 }, 5000, false).opacity).toBe(1)
    expect(model.sample({ col: 0, row: 0 }, 750, true).opacity).toBe(CALM_BLINK.floor)
    model.noteKeystroke(800)
    expect(model.sample({ col: 0, row: 0 }, 900, true).opacity).toBe(1)
  })
})
