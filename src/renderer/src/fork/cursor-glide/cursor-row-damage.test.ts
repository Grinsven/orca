import { describe, expect, it } from 'vitest'
import { CursorRowDamage } from './cursor-row-damage'

function screen(rows: string[]): (row: number) => string | null {
  return (row) => rows[row] ?? null
}

describe('CursorRowDamage', () => {
  it('counts only rows whose text changed, not rows the cursor passed through', () => {
    const damage = new CursorRowDamage()
    const rows = ['header', '', '> ', '', 'status']
    damage.measure({ start: 0, end: 4 }, 2, screen(rows))
    // The program homed the cursor, repainted the input row and parked on the last row.
    const typed = ['header', '', '> h', '', 'status']
    expect(damage.measure({ start: 0, end: 4 }, 2, screen(typed))).toEqual({
      rowsDamaged: 1,
      touchesCursorRow: true
    })
  })

  it('counts every row a redraw rewrote', () => {
    const damage = new CursorRowDamage()
    damage.measure({ start: 0, end: 3 }, 3, screen(['a', 'b', 'c', '$ ']))
    expect(damage.measure({ start: 0, end: 3 }, 3, screen(['x', 'y', 'z', '$ '])).rowsDamaged).toBe(
      3
    )
  })

  it('does not blame a typed write for rows other output changed in between', () => {
    const damage = new CursorRowDamage()
    damage.measure({ start: 0, end: 2 }, 2, screen(['spinner 1', '', '> ']))
    // A spinner tick is not a typed write; its rows are forgotten rather than read.
    damage.forget({ start: 0, end: 0 })
    const result = damage.measure({ start: 0, end: 2 }, 2, screen(['spinner 2', '', '> x']))
    expect(result).toEqual({ rowsDamaged: 1, touchesCursorRow: true })
  })

  it('reports no damage for rows it has never read', () => {
    const damage = new CursorRowDamage()
    expect(damage.measure({ start: 0, end: 1 }, 0, screen(['a', 'b'])).rowsDamaged).toBe(0)
  })
})
