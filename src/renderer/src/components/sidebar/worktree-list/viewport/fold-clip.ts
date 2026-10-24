import { ease3, EASE3_CSS } from '@/fork/diri-motion/motion'
import { readMotionState, type MotionState } from '@/fork/diri-motion/motion-tracks'
import { WORKTREE_SIDEBAR_VIRTUAL_ROW_GAP } from './virtual-rows'

/** A folding row's layout box: its top in a space the whole group shares, and its height. */
export type FoldClipRow = { element: HTMLElement; top: number; height: number }

/**
 * The group's moving edge, as a height below the group's top: `fromPx` to `toPx` on ease3.
 * Each group row shows only above it, so the rows below, gliding on the same curve, ride it.
 */
export type FoldEdgeRun = {
  rows: FoldClipRow[]
  groupTop: number
  fromPx: number
  toPx: number
  startedAt: number
  durationMs: number
}

// Why past the box by a row gap: a card's shadow shows before the clip lifts, so its end is invisible.
const OVERHANG_PX = WORKTREE_SIDEBAR_VIRTUAL_ROW_GAP
// Why widen the other sides: only the moving edge clips; overhanging chevrons and rings stay painted.
const SIDE_SLACK_PX = 64

/** How much of a row at offset `y` with height `h` shows when the edge is `edgePx` down the group. */
export function foldVisibleHeight(y: number, h: number, edgePx: number, overhangPx = 0): number {
  return Math.min(h + overhangPx, Math.max(0, edgePx - y))
}

function clipInset(bottomPx: number): string {
  const bottom = Math.round(bottomPx * 1000) / 1000
  return `inset(-${SIDE_SLACK_PX}px -${SIDE_SLACK_PX}px ${bottom}px -${SIDE_SLACK_PX}px)`
}

/**
 * clip-path keyframes over the edge's eased progress. The visible height is linear in that
 * progress between where the edge reaches the row and where it passes it, so keyframes at
 * those offsets track the edge exactly with no per-frame script.
 */
export function foldClipKeyframes(y: number, h: number, fromPx: number, toPx: number): Keyframe[] {
  const span = toPx - fromPx
  const offsets = [0, 1]
  for (const at of span === 0 ? [] : [y, y + h + OVERHANG_PX]) {
    const offset = (at - fromPx) / span
    if (offset > 0 && offset < 1) {
      offsets.push(offset)
    }
  }
  return offsets
    .sort((left, right) => left - right)
    .map((offset) => ({
      offset,
      clipPath: clipInset(h - foldVisibleHeight(y, h, fromPx + span * offset, OVERHANG_PX))
    }))
}

const clips = new WeakMap<Element, Animation>()

export function startFoldEdge(
  rows: FoldClipRow[],
  edge: { groupTop: number; fromPx: number; toPx: number },
  durationMs: number,
  now: number
): FoldEdgeRun {
  for (const row of rows) {
    clips.get(row.element)?.cancel()
    if (typeof row.element.animate === 'function' && durationMs > 0) {
      const keyframes = foldClipKeyframes(
        row.top - edge.groupTop,
        row.height,
        edge.fromPx,
        edge.toPx
      )
      // Why hold a closing clip: the copy is removed when its own fade ends, not before.
      const fill = edge.toPx < edge.fromPx ? 'forwards' : 'none'
      clips.set(
        row.element,
        row.element.animate(keyframes, { duration: durationMs, easing: EASE3_CSS, fill })
      )
    }
  }
  return { rows, ...edge, startedAt: now, durationMs }
}

/** The edge's height below the group's top at `now`. */
export function foldEdgeAt(run: FoldEdgeRun, now: number): number {
  return run.fromPx + (run.toPx - run.fromPx) * ease3((now - run.startedAt) / run.durationMs)
}

/** The box a row is laid out in, without the translate a fold is moving it by. */
function layoutBox(element: HTMLElement): FoldClipRow {
  const rect = element.getBoundingClientRect()
  return { element, top: rect.top - (readMotionState(element)?.y ?? 0), height: rect.height }
}

type BelowCandidate = { top: number; paintedTop: number }

/** Where the group ends and where its edge starts: at the row below, if one is on screen. */
function edgeSpan(
  rows: readonly FoldClipRow[],
  candidates: readonly BelowCandidate[]
): { groupTop: number; heightPx: number; below: BelowCandidate | null } {
  const groupTop = Math.min(...rows.map((row) => row.top))
  const groupBottom = Math.max(...rows.map((row) => row.top + row.height))
  let below: BelowCandidate | null = null
  for (const candidate of candidates) {
    if (candidate.top >= groupBottom - 0.5 && (!below || candidate.top < below.top)) {
      below = candidate
    }
  }
  const heightPx = below ? below.top - groupTop : groupBottom + OVERHANG_PX - groupTop
  return { groupTop, heightPx, below }
}

/**
 * Opens from where the row below is drawn now (its glide's start) to the group's full height.
 * Call before the rows' own motion starts; `persisting` gives each other row's glide start.
 */
export function openFoldEdge(
  opening: readonly HTMLElement[],
  persisting: readonly { element: HTMLElement; fromY: number }[],
  durationMs: number,
  now: number
): FoldEdgeRun | null {
  if (opening.length === 0) {
    return null
  }
  const rows = opening.map(layoutBox)
  const candidates = persisting.map(({ element, fromY }) => {
    const box = layoutBox(element)
    return { top: box.top, paintedTop: box.top + fromY }
  })
  const { groupTop, heightPx, below } = edgeSpan(rows, candidates)
  const fromPx = below ? Math.min(heightPx, Math.max(0, below.paintedTop - groupTop)) : 0
  return startFoldEdge(rows, { groupTop, fromPx, toPx: heightPx }, durationMs, now)
}

/** Keeps the edge where it is and lands it on a group whose rows settled at new sizes. */
export function retargetFoldEdge(
  run: FoldEdgeRun,
  opening: readonly HTMLElement[],
  persisting: readonly HTMLElement[],
  now: number,
  endsAt: number
): FoldEdgeRun {
  const rows = opening.filter((element) => element.isConnected).map(layoutBox)
  if (rows.length === 0) {
    return run
  }
  const candidates = persisting.map(layoutBox).map((box) => ({ top: box.top, paintedTop: box.top }))
  const { groupTop, heightPx } = edgeSpan(rows, candidates)
  const unchanged =
    rows.length === run.rows.length &&
    Math.abs(groupTop - run.groupTop) < 0.5 &&
    Math.abs(heightPx - run.toPx) < 0.5
  if (unchanged) {
    return run
  }
  const edge = run.groupTop + foldEdgeAt(run, now) - groupTop
  return startFoldEdge(rows, { groupTop, fromPx: edge, toPx: heightPx }, endsAt - now, now)
}

/** Closes from where the row below is drawn to the group's top; copies show only above it. */
export function closeFoldEdge(
  copies: readonly FoldClipRow[],
  staying: readonly { box: { top: number }; state: MotionState }[],
  durationMs: number,
  now: number
): FoldEdgeRun | null {
  if (copies.length === 0) {
    return null
  }
  const candidates = staying.map(({ box, state }) => ({
    top: box.top,
    paintedTop: box.top + state.y
  }))
  const { groupTop, heightPx, below } = edgeSpan(copies, candidates)
  const fromPx = below ? Math.max(0, below.paintedTop - groupTop) : heightPx
  return startFoldEdge([...copies], { groupTop, fromPx, toPx: 0 }, durationMs, now)
}
