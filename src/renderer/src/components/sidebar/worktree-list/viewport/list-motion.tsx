import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { useWorktreeSidebarHeaderDrag } from '../drag/use-header-drag'
import { createSidebarFoldMotion } from './fold-motion'
import {
  createListTopFadeWriter,
  getPinnedHeaderInset,
  getWorktreeListMotionStyle,
  WORKTREE_LIST_FADE_STYLE
} from './list-end-fade'

/** Fold motion, its overlay and the list's end fade for one sidebar list. */
export function useWorktreeListMotion(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const foldOverlayRef = useRef<HTMLDivElement>(null)
  const [foldMotion] = useState(createSidebarFoldMotion)
  const [writeTopFade] = useState(createListTopFadeWriter)
  const syncTopFade = useCallback(() => {
    writeTopFade(containerRef.current, scrollRef.current?.scrollTop ?? 0)
  }, [scrollRef, writeTopFade])
  useLayoutEffect(syncTopFade, [syncTopFade])
  return { containerRef, foldOverlayRef, foldMotion, syncTopFade }
}

export function useWorktreeListMotionStyle(hostPinned: boolean, groupPinned: boolean) {
  const inset = getPinnedHeaderInset(hostPinned, groupPinned)
  return useMemo(() => getWorktreeListMotionStyle(inset), [inset])
}

/** A drag lands at once; a fold mid-drag would move rows under the pointer. */
export function isWorktreeListDragActive(
  draggingWorktreeId: string | null,
  headerDrag: ReturnType<typeof useWorktreeSidebarHeaderDrag>
): boolean {
  return (
    draggingWorktreeId !== null ||
    headerDrag.hostDrag.state.draggingHostId !== null ||
    headerDrag.repoDrag.state.draggingRepoId !== null ||
    headerDrag.projectGroupDrag.state.draggingGroupId !== null
  )
}

/** Holds copies of a closing group's rows; it sits under the list so gliding rows pass over. */
export function WorktreeListFoldOverlay({
  ref
}: {
  ref: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  return (
    <div
      ref={ref}
      aria-hidden
      inert
      data-worktree-fold-overlay=""
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={WORKTREE_LIST_FADE_STYLE}
    />
  )
}
