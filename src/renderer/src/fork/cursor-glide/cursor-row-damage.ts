// Counts rows whose text a typed write changed. xterm's dirty range also covers rows the cursor
// only passed through: Claude Code homes the cursor and parks it on the last row before placing
// it in the input box, which would read as a full-screen redraw for every typed character.

export type RowTextReader = (absoluteRow: number) => string | null

export class CursorRowDamage {
  private readonly textByRow = new Map<number, string>()

  reset(): void {
    this.textByRow.clear()
  }

  /** A write that cannot glide: forget the rows it touched instead of reading them. */
  forget(dirty: { start: number; end: number }): void {
    for (let row = dirty.start; row <= dirty.end; row += 1) {
      this.textByRow.delete(row)
    }
  }

  /**
   * Rows in `dirty` whose text differs from what this tracker last read. A row it has no text
   * for counts as unchanged: only typed writes are read, so most rows are unknown, and the move
   * distance and keystroke rules already rule out the redraws that matter.
   */
  measure(
    dirty: { start: number; end: number },
    cursorRow: number,
    readRow: RowTextReader
  ): { rowsDamaged: number; touchesCursorRow: boolean } {
    let rowsDamaged = 0
    let touchesCursorRow = false
    for (let row = dirty.start; row <= dirty.end; row += 1) {
      const text = readRow(row)
      const known = this.textByRow.get(row)
      if (known !== undefined && known !== text) {
        rowsDamaged += 1
        touchesCursorRow ||= row === cursorRow
      }
      if (text === null) {
        this.textByRow.delete(row)
      } else {
        this.textByRow.set(row, text)
      }
    }
    // A long session moves through many rows; only the recent neighbourhood matters.
    if (this.textByRow.size > 512) {
      this.textByRow.clear()
    }
    return { rowsDamaged, touchesCursorRow }
  }
}
