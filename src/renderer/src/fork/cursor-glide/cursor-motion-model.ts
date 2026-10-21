// Cursor glide and calm blink as pure functions of time, after Diri's cursor rules.
// Nothing here reads a clock: every call takes `now` in ms, so tests step time by hand.

export const CURSOR_GLIDE = {
  durationMs: 80,
  /** Word motions and short edits stay inside these; prompt redraws and wraps do not. */
  maxCols: 8,
  maxRows: 2,
  /** Typing at the wrap edge changes two rows. More is a redraw. */
  maxDamagedRows: 2,
  /** Output closer together than this is a stream, not an echo (fastest key repeat is 30 ms). */
  streamingGapMs: 20,
  /** A move glides only when a keystroke came this recently; covers a remote echo. */
  keystrokeWindowMs: 350
} as const

export const CALM_BLINK = {
  /** Solid while in use: blinking during typing is what makes blinking annoying. */
  idleDelayMs: 500,
  fadeMs: 200,
  lowHoldMs: 300,
  highHoldMs: 500,
  cycleMs: 1200,
  /** Never fully gone, so the eye does not hunt for the insertion point. */
  floor: 0.28,
  /** A finite response to going idle; after this the cursor rests and nothing paints. */
  cycles: 10
} as const

export type CursorCell = { col: number; row: number }

export type CursorSchedule = { kind: 'rest' } | { kind: 'frame' } | { kind: 'after'; ms: number }

export type CursorFrame = {
  opacity: number
  /** Offset from the true cell, in cells. Zero at rest. */
  offsetCols: number
  offsetRows: number
  schedule: CursorSchedule
}

/** One parsed write, as seen from the cursor. Null cells mean the cursor was not visible. */
export type CursorUpdate = {
  previous: CursorCell | null
  next: CursorCell | null
  rowsDamaged: number
  touchesCursorRow: boolean
}

const REST: CursorSchedule = { kind: 'rest' }
const FRAME: CursorSchedule = { kind: 'frame' }

export function easeOutCubic(t: number): number {
  const inverse = 1 - Math.min(1, Math.max(0, t))
  return 1 - inverse * inverse * inverse
}

export function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

/** Glide short moves the user caused; snap everything else. */
export function shouldGlide(move: {
  previous: CursorCell
  next: CursorCell
  rowsDamaged: number
  sinceOutputMs: number | null
  sinceKeystrokeMs: number | null
}): boolean {
  const cols = Math.abs(move.previous.col - move.next.col)
  const rows = Math.abs(move.previous.row - move.next.row)
  const short =
    (cols !== 0 || rows !== 0) && cols <= CURSOR_GLIDE.maxCols && rows <= CURSOR_GLIDE.maxRows
  const streaming = move.sinceOutputMs !== null && move.sinceOutputMs < CURSOR_GLIDE.streamingGapMs
  const userCaused =
    move.sinceKeystrokeMs !== null && move.sinceKeystrokeMs <= CURSOR_GLIDE.keystrokeWindowMs
  return short && move.rowsDamaged <= CURSOR_GLIDE.maxDamagedRows && !streaming && userCaused
}

/** Opacity `idleMs` after the last activity: hold, fade down, hold low, fade up, hold high. */
export function calmBlinkOpacity(idleMs: number): number {
  const blinking = idleMs - CALM_BLINK.idleDelayMs
  if (blinking < 0 || blinking >= CALM_BLINK.cycleMs * CALM_BLINK.cycles) {
    return 1
  }
  const phase = blinking % CALM_BLINK.cycleMs
  const fadeUpAt = CALM_BLINK.fadeMs + CALM_BLINK.lowHoldMs
  let covered: number
  if (phase < CALM_BLINK.fadeMs) {
    covered = 1 - smoothstep(phase / CALM_BLINK.fadeMs)
  } else if (phase < fadeUpAt) {
    covered = 0
  } else if (phase < fadeUpAt + CALM_BLINK.fadeMs) {
    covered = smoothstep((phase - fadeUpAt) / CALM_BLINK.fadeMs)
  } else {
    covered = 1
  }
  return CALM_BLINK.floor + (1 - CALM_BLINK.floor) * covered
}

/** When the blink next needs a frame. Fades ride every frame; a hold sleeps until its fade. */
export function calmBlinkSchedule(idleMs: number): CursorSchedule {
  const blinking = idleMs - CALM_BLINK.idleDelayMs
  if (blinking < 0) {
    return { kind: 'after', ms: Math.max(1, -blinking) }
  }
  // The last cycle ends on its high hold, which already looks like rest.
  if (blinking >= CALM_BLINK.cycleMs * CALM_BLINK.cycles - CALM_BLINK.highHoldMs) {
    return REST
  }
  const phase = blinking % CALM_BLINK.cycleMs
  const fadeUpAt = CALM_BLINK.fadeMs + CALM_BLINK.lowHoldMs
  if (phase < CALM_BLINK.fadeMs || (phase >= fadeUpAt && phase < fadeUpAt + CALM_BLINK.fadeMs)) {
    return FRAME
  }
  const remaining = phase < fadeUpAt ? fadeUpAt - phase : CALM_BLINK.cycleMs - phase
  return { kind: 'after', ms: Math.max(1, remaining) }
}

type Glide = { fromCol: number; fromRow: number; to: CursorCell; startedAt: number }

function glidePosition(glide: Glide, now: number): { col: number; row: number } | null {
  const elapsed = now - glide.startedAt
  if (elapsed >= CURSOR_GLIDE.durationMs) {
    return null
  }
  const eased = easeOutCubic(Math.max(0, elapsed) / CURSOR_GLIDE.durationMs)
  return {
    col: glide.fromCol + (glide.to.col - glide.fromCol) * eased,
    row: glide.fromRow + (glide.to.row - glide.fromRow) * eased
  }
}

function sameCell(a: CursorCell, b: CursorCell): boolean {
  return a.col === b.col && a.row === b.row
}

/** Per-terminal cursor animation state. */
export class CursorMotionModel {
  private lastActivity: number | null = null
  private lastKeystroke: number | null = null
  private lastOutput: number | null = null
  private glide: Glide | null = null

  /** A key or committed text went to the program. */
  noteKeystroke(now: number): void {
    this.lastKeystroke = now
    this.lastActivity = now
  }

  /** Any activity that should hold the blink solid, such as focus or a resize. */
  noteActivity(now: number): void {
    this.lastActivity = now
  }

  noteUpdate(update: CursorUpdate, now: number): void {
    const sinceOutputMs = this.lastOutput === null ? null : now - this.lastOutput
    this.lastOutput = now
    const { previous, next } = update
    const moved = previous === null || next === null ? previous !== next : !sameCell(previous, next)
    if (moved || update.touchesCursorRow) {
      this.lastActivity = now
    }
    if (previous === null || next === null) {
      this.glide = null
      return
    }
    if (!moved) {
      return
    }
    const glides = shouldGlide({
      previous,
      next,
      rowsDamaged: update.rowsDamaged,
      sinceOutputMs,
      sinceKeystrokeMs: this.lastKeystroke === null ? null : now - this.lastKeystroke
    })
    if (!glides) {
      this.glide = null
      return
    }
    // Retarget from where the block is now, so a held key is one continuous motion.
    const from = (this.glide && glidePosition(this.glide, now)) ?? previous
    this.glide = { fromCol: from.col, fromRow: from.row, to: next, startedAt: now }
  }

  /**
   * Whether a write that moved the cursor from `previous` to `next` could glide, before row
   * damage is known. Lets the caller skip reading rows for every write that cannot glide.
   */
  isGlideCandidate(previous: CursorCell | null, next: CursorCell | null, now: number): boolean {
    if (previous === null || next === null) {
      return false
    }
    return shouldGlide({
      previous,
      next,
      rowsDamaged: 0,
      sinceOutputMs: this.lastOutput === null ? null : now - this.lastOutput,
      sinceKeystrokeMs: this.lastKeystroke === null ? null : now - this.lastKeystroke
    })
  }

  /** The cursor jumped for a reason no glide should cover (scroll, resize, buffer switch). */
  snap(): void {
    this.glide = null
  }

  isGliding(now: number): boolean {
    return this.glide !== null && glidePosition(this.glide, now) !== null
  }

  /** The frame for a cursor drawn at `cell`. */
  sample(cell: CursorCell, now: number, blink: boolean): CursorFrame {
    if (this.glide) {
      const position = sameCell(this.glide.to, cell) ? glidePosition(this.glide, now) : null
      if (position) {
        return {
          opacity: 1,
          offsetCols: position.col - cell.col,
          offsetRows: position.row - cell.row,
          schedule: FRAME
        }
      }
      this.glide = null
    }
    if (!blink) {
      return { opacity: 1, offsetCols: 0, offsetRows: 0, schedule: REST }
    }
    const idleMs = this.lastActivity === null ? Number.POSITIVE_INFINITY : now - this.lastActivity
    return {
      opacity: calmBlinkOpacity(idleMs),
      offsetCols: 0,
      offsetRows: 0,
      schedule: calmBlinkSchedule(idleMs)
    }
  }
}
