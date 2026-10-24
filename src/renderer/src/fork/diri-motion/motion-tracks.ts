import { ease3, EASE3_CSS } from './motion'

/** A vertical offset from the element's layout position and its opacity. */
export type MotionState = { y: number; opacity: number }

export const REST_STATE: MotionState = { y: 0, opacity: 1 }

type MotionTrack = {
  animation: Animation
  from: MotionState
  to: MotionState
  delayMs: number
  durationMs: number
}

// Why a registry: WAAPI cannot say where a running animation is in our units, and a reversal
// must start from there; reading computed style for it would force a style pass per row.
const tracks = new WeakMap<Element, MotionTrack>()

/** The state `localTimeMs` (including the delay) into a run from `from` to `to` on ease3. */
export function sampleMotion(
  run: Pick<MotionTrack, 'from' | 'to' | 'delayMs' | 'durationMs'>,
  localTimeMs: number
): MotionState {
  const progress = run.durationMs <= 0 ? 1 : ease3((localTimeMs - run.delayMs) / run.durationMs)
  return {
    y: run.from.y + (run.to.y - run.from.y) * progress,
    opacity: run.from.opacity + (run.to.opacity - run.from.opacity) * progress
  }
}

/** Where `element` is drawn now relative to its layout, or null when nothing moves it. */
export function readMotionState(element: Element): MotionState | null {
  const track = tracks.get(element)
  if (!track) {
    return null
  }
  const time = track.animation.currentTime
  return sampleMotion(track, typeof time === 'number' ? time : 0)
}

export function cancelMotion(element: Element): void {
  const track = tracks.get(element)
  if (track) {
    tracks.delete(element)
    track.animation.cancel()
  }
}

function isRest(state: MotionState): boolean {
  return state.y === 0 && state.opacity === 1
}

function toKeyframe(state: MotionState, offset?: number): Keyframe {
  const keyframe: Keyframe = {
    translate: `0 ${state.y}px`,
    opacity: state.opacity
  }
  if (offset !== undefined) {
    keyframe.offset = offset
  }
  return keyframe
}

/**
 * Moves `element` from `from` to `to` on ease3, replacing whatever it was doing. Ending at
 * rest uses an implicit last keyframe, so the run lands on the element's own style with no
 * snap. A negative delay joins a run that started earlier.
 */
export function playMotion(
  element: HTMLElement,
  run: {
    from: MotionState
    to?: MotionState
    delayMs?: number
    durationMs: number
  },
  onFinish?: () => void
): Animation | null {
  cancelMotion(element)
  const to = run.to ?? REST_STATE
  const delayMs = run.delayMs ?? 0
  if (run.durationMs <= 0 || typeof element.animate !== 'function') {
    onFinish?.()
    return null
  }
  const keyframes = isRest(to) ? [toKeyframe(run.from, 0)] : [toKeyframe(run.from), toKeyframe(to)]
  const animation = element.animate(keyframes, {
    duration: run.durationMs,
    delay: delayMs,
    easing: EASE3_CSS,
    fill: 'backwards'
  })
  const track: MotionTrack = {
    animation,
    from: run.from,
    to,
    delayMs,
    durationMs: run.durationMs
  }
  tracks.set(element, track)
  animation.addEventListener('finish', () => {
    if (tracks.get(element) === track) {
      tracks.delete(element)
    }
    onFinish?.()
  })
  return animation
}

/**
 * The layout under `element` moved by `deltaY` mid-run: keep it drawn where it was and land on
 * the run's original schedule. An element at rest glides over `fallbackMs`.
 */
export function shiftMotion(element: HTMLElement, deltaY: number, fallbackMs: number): void {
  const track = tracks.get(element)
  if (!track) {
    playMotion(element, {
      from: { y: deltaY, opacity: 1 },
      durationMs: fallbackMs
    })
    return
  }
  const time = track.animation.currentTime
  const localTimeMs = typeof time === 'number' ? time : 0
  const state = sampleMotion(track, localTimeMs)
  const delayMs = Math.max(0, track.delayMs - localTimeMs)
  playMotion(element, {
    from: { y: state.y + deltaY, opacity: state.opacity },
    to: track.to,
    delayMs,
    durationMs: track.delayMs + track.durationMs - localTimeMs - delayMs
  })
}
