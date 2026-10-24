import { useCallback, useMemo } from 'react'
import type React from 'react'
import { useAppStore } from '@/store'
import { VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT } from '@/hooks/useVirtualizedScrollAnchor'
import { createLineageToggleHandlerCache } from '../../worktree-lineage-toggle-handler-cache'
import type { SidebarFoldMotion } from './fold-motion'
import type { WorktreeListVirtualizer } from './use-virtualizer'

// Collapsing a section changes total height, so snapshot the anchor first or the viewport jumps.
export function useGroupToggleWithScrollAnchor(args: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  toggleGroup: (key: string) => void
  foldMotion: SidebarFoldMotion
  foldOverlayRef: React.RefObject<HTMLDivElement | null>
  virtualizer: WorktreeListVirtualizer['virtualizer']
}) {
  const { scrollRef, toggleGroup, foldMotion, foldOverlayRef, virtualizer } = args
  const recordCurrentScrollAnchor = useCallback(() => {
    scrollRef.current?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT))
  }, [scrollRef])
  const toggleGroupWithScrollAnchor = useCallback(
    (groupKey: string) => {
      recordCurrentScrollAnchor()
      const scrollElement = scrollRef.current
      if (scrollElement) {
        // Why here: a closing group's rows leave the DOM in this commit; copy them first.
        foldMotion.begin({
          direction: useAppStore.getState().collapsedGroups.has(groupKey) ? 'open' : 'close',
          scrollElement,
          overlayHost: foldOverlayRef.current,
          measurements: virtualizer.measurementsCache
        })
      }
      toggleGroup(groupKey)
    },
    [foldMotion, foldOverlayRef, recordCurrentScrollAnchor, scrollRef, toggleGroup, virtualizer]
  )
  // Why: memo'd WorktreeCard needs a per-group-key stable onLineageToggle
  // identity to bail out of re-renders; see worktree-lineage-toggle-handler-cache.
  const getLineageToggleHandler = useMemo(
    () => createLineageToggleHandlerCache(toggleGroupWithScrollAnchor),
    [toggleGroupWithScrollAnchor]
  )

  return { toggleGroupWithScrollAnchor, getLineageToggleHandler }
}
