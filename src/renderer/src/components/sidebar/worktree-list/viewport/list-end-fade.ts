import type { CSSProperties } from 'react'
import {
  buildListEndFadeMask,
  listTopFadeStrength,
  SIDEBAR_CARD_MOTION_VARS
} from '@/fork/diri-motion/motion'
import { GROUP_HEADER_ROW_HEIGHT, HOST_HEADER_ROW_HEIGHT } from './virtual-rows'

export type WorktreeListMotionStyle = CSSProperties & Record<`--${string}`, string | number>

/** The list and the fold overlay fade out at both ends the same way. */
export const WORKTREE_LIST_FADE_STYLE: CSSProperties = { maskImage: buildListEndFadeMask() }

/** Where pinned headers end; the top fade starts below them so it never dims a header. */
export function getPinnedHeaderInset(hostPinned: boolean, groupPinned: boolean): number {
  // Why these offsets: the host card pins at -1px and a group header under it at 35px.
  const hostBottom = hostPinned ? HOST_HEADER_ROW_HEIGHT - 1 : -1
  if (groupPinned) {
    return hostBottom + GROUP_HEADER_ROW_HEIGHT
  }
  return hostPinned ? hostBottom : 0
}

export function getWorktreeListMotionStyle(pinnedInsetPx: number): WorktreeListMotionStyle {
  return { ...SIDEBAR_CARD_MOTION_VARS, '--list-fade-inset': `${pinnedInsetPx}px` }
}

/** Ramps the top fade in over the first px of scroll; writes only when the strength changes. */
export function createListTopFadeWriter(): (target: HTMLElement | null, scrollTop: number) => void {
  let written = -1
  return (target, scrollTop) => {
    const strength = listTopFadeStrength(scrollTop)
    if (target && strength !== written) {
      written = strength
      target.style.setProperty('--list-top-fade', String(strength))
    }
  }
}
