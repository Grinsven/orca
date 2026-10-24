// Sidebar and tab bar motion after Diri's numbers and curves; the code is new.
// Every duration, distance and curve both surfaces animate with lives here.
import './diri-motion.css'

/** Group open and close in the sidebar. */
export const FOLD_MOTION = {
  openMs: 300,
  closeMs: 180,
  /** Opening rows slide down from this far above; closing rows rise by it. */
  offsetPx: 6,
  /** Row i starts after min(i * step, cap) of the open, so every row still ends at `openMs`. */
  staggerStep: 0.073,
  staggerCap: 0.36
} as const

/** Rows that close up after a removal by data (not a fold) glide this long. */
export const ROW_REMOVAL_MOTION = {
  durationMs: 180
} as const

export const CARD_MOTION = {
  /** Hover fill appears at once and fades out as 1 - spring(hoverSpring, p). */
  hoverOutMs: 110,
  hoverSpring: 3,
  selectionInMs: 160,
  selectionSpring: (7 * 0.74) / 0.82
} as const

export const AGENT_ROW_MOTION = {
  inMs: 220,
  outMs: 200
} as const

export const TAB_MOTION = {
  growMs: 180,
  shrinkMs: 150
} as const

export const LIST_END_FADE = {
  /** The scrolling list fades out over this much of its top and bottom. */
  fadePx: 28,
  /** The top fade ramps in over the first this-many px of scroll. */
  topRampPx: 14
} as const

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 1 - (1 - t)^3: fast start, soft landing. */
export function ease3(t: number): number {
  const inverse = 1 - clamp01(t)
  return 1 - inverse * inverse * inverse
}

export const EASE3_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)'

/** Critically damped settle scaled to land exactly on 1 at p = 1; it never overshoots. */
export function spring(k: number, p: number): number {
  if (p <= 0) {
    return 0
  }
  if (p >= 1) {
    return 1
  }
  return (1 - (1 + k * p) * Math.exp(-k * p)) / (1 - (1 + k) * Math.exp(-k))
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

/** A CSS `linear()` easing sampled from `curve` at `segments` even steps. */
export function toLinearEasing(curve: (p: number) => number, segments = 24): string {
  const stops: string[] = []
  for (let index = 0; index <= segments; index++) {
    const p = index / segments
    stops.push(`${roundTo(curve(p), 4)} ${roundTo(p * 100, 2)}%`)
  }
  return `linear(${stops.join(', ')})`
}

export const CARD_HOVER_OUT_EASING = toLinearEasing((p) => spring(CARD_MOTION.hoverSpring, p))
export const CARD_SELECTION_IN_EASING = toLinearEasing((p) =>
  spring(CARD_MOTION.selectionSpring, p)
)

/** Card fill timings for diri-motion.css, set on the sidebar container. */
export const SIDEBAR_CARD_MOTION_VARS = {
  '--worktree-card-hover-out-duration': `${CARD_MOTION.hoverOutMs}ms`,
  '--worktree-card-hover-out-easing': CARD_HOVER_OUT_EASING,
  '--worktree-card-selection-in-duration': `${CARD_MOTION.selectionInMs}ms`,
  '--worktree-card-selection-in-easing': CARD_SELECTION_IN_EASING
} as const

/** Delay before row `index` (0-based, top to bottom) of an opening group starts. */
export function foldRowDelayMs(index: number): number {
  return Math.min(index * FOLD_MOTION.staggerStep, FOLD_MOTION.staggerCap) * FOLD_MOTION.openMs
}

/** How far row `index` of an opening group has come in, 0 to 1, `elapsedMs` into the open. */
export function foldOpenProgress(elapsedMs: number, index = 0): number {
  const delayMs = foldRowDelayMs(index)
  return ease3((elapsedMs - delayMs) / (FOLD_MOTION.openMs - delayMs))
}

/** How much of a closing group's rows is still showing, 1 to 0, `elapsedMs` into the close. */
export function foldCloseRemaining(elapsedMs: number): number {
  return 1 - ease3(elapsedMs / FOLD_MOTION.closeMs)
}

/** Hover fill strength `elapsedMs` after the pointer left the card. */
export function cardHoverFill(elapsedMs: number): number {
  return 1 - spring(CARD_MOTION.hoverSpring, elapsedMs / CARD_MOTION.hoverOutMs)
}

/** Selection fill strength `elapsedMs` after the card became selected. */
export function cardSelectionFill(elapsedMs: number): number {
  return spring(CARD_MOTION.selectionSpring, elapsedMs / CARD_MOTION.selectionInMs)
}

export function tabGrowWidth(elapsedMs: number, widthPx: number): number {
  return widthPx * ease3(elapsedMs / TAB_MOTION.growMs)
}

export function tabShrinkWidth(elapsedMs: number, widthPx: number): number {
  return widthPx * (1 - ease3(elapsedMs / TAB_MOTION.shrinkMs))
}

/** Strength of the list's top fade, 0 unscrolled to 1 once scrolled past the ramp. */
export function listTopFadeStrength(scrollTop: number): number {
  return roundTo(clamp01(scrollTop / LIST_END_FADE.topRampPx), 3)
}

/**
 * Mask for a scrolling list: opaque under `insetPx` (pinned headers), then a top fade that
 * `--list-top-fade` (0 to 1) ramps in, and a fixed bottom fade.
 */
export function buildListEndFadeMask(fadePx: number = LIST_END_FADE.fadePx): string {
  const inset = 'var(--list-fade-inset, 0px)'
  return [
    'linear-gradient(to bottom',
    `black ${inset}`,
    `rgb(0 0 0 / calc(1 - var(--list-top-fade, 0))) ${inset}`,
    `black calc(${inset} + ${fadePx}px)`,
    `black calc(100% - ${fadePx}px)`,
    'transparent 100%)'
  ].join(', ')
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false
}
