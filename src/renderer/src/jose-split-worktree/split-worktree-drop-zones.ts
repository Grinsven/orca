import type { SplitEdge } from './split-worktree-state'

export type SplitRect = { left: number; top: number; width: number; height: number }

// The outer quarter exposes a destination while leaving the center inert.
const EDGE_BAND = 0.25

export function splitEdgeAt(rect: SplitRect, x: number, y: number): SplitEdge | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }
  const dx = (x - rect.left) / rect.width
  const dy = (y - rect.top) / rect.height
  if (dx < 0 || dx > 1 || dy < 0 || dy > 1) {
    return null
  }
  const distances: readonly [SplitEdge, number][] = [
    ['left', dx],
    ['right', 1 - dx],
    ['top', dy],
    ['bottom', 1 - dy]
  ]
  let edge: SplitEdge | null = null
  let distance = EDGE_BAND
  for (const candidate of distances) {
    if (candidate[1] < distance) {
      edge = candidate[0]
      distance = candidate[1]
    }
  }
  return edge
}

export function splitHalfRect(rect: SplitRect, edge: SplitEdge): SplitRect {
  if (edge === 'left') {
    return { ...rect, width: rect.width / 2 }
  }
  if (edge === 'right') {
    return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 }
  }
  if (edge === 'top') {
    return { ...rect, height: rect.height / 2 }
  }
  return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 }
}

export function pointInSplitRect(rect: SplitRect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  )
}
