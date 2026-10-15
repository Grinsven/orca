import { useRef } from 'react'
import { useSplitWorktreeState, publishSplitLayout } from './split-worktree-state'
import { applySplitSurfaceGeometry } from './split-worktree-surface'
import { activeSplitWorkspace } from './split-worktree-actions'
import { saveSplitWorktreeLayout } from './split-worktree-persistence'

// Both workspace frames must retain usable space at the divider extremes.
export const MIN_WORKSPACE_RATIO = 0.15
export const MAX_WORKSPACE_RATIO = 0.85

export function SplitWorktreeDivider(): React.JSX.Element | null {
  const layout = useSplitWorktreeState((state) => state.layout)
  const drag = useRef<{ pointerId: number; rect: DOMRect; ratio: number } | null>(null)
  if (!layout) {
    return null
  }
  const horizontal = layout.axis === 'horizontal'
  const clamp = (ratio: number): number =>
    Math.min(MAX_WORKSPACE_RATIO, Math.max(MIN_WORKSPACE_RATIO, ratio))
  const commit = (ratio: number): void => {
    const next = { ...layout, ratio: clamp(ratio) }
    publishSplitLayout(next)
    const focus = activeSplitWorkspace()
    if (focus) {
      saveSplitWorktreeLayout(next, focus)
    }
  }
  return (
    <div
      role="separator"
      aria-label="Resize workspaces"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(layout.ratio * 100)}
      tabIndex={0}
      className="absolute z-20 bg-border hover:bg-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={
        horizontal
          ? {
              left: `calc(${layout.ratio * 100}% - 2px)`,
              top: 0,
              bottom: 0,
              width: 4,
              cursor: 'col-resize'
            }
          : {
              top: `calc(${layout.ratio * 100}% - 2px)`,
              left: 0,
              right: 0,
              height: 4,
              cursor: 'row-resize'
            }
      }
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) {
          return
        }
        const parent = event.currentTarget.parentElement
        if (!parent) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        drag.current = {
          pointerId: event.pointerId,
          rect: parent.getBoundingClientRect(),
          ratio: layout.ratio
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) {
          return
        }
        current.ratio = clamp(
          horizontal
            ? (event.clientX - current.rect.left) / current.rect.width
            : (event.clientY - current.rect.top) / current.rect.height
        )
        applySplitSurfaceGeometry({ ...layout, ratio: current.ratio })
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) {
          return
        }
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        commit(current.ratio)
      }}
      onPointerCancel={() => {
        drag.current = null
        applySplitSurfaceGeometry(layout)
      }}
      onLostPointerCapture={() => {
        if (drag.current) {
          drag.current = null
          applySplitSurfaceGeometry(layout)
        }
      }}
      onKeyDown={(event) => {
        const delta =
          event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -0.05
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? 0.05
              : 0
        if (delta) {
          event.preventDefault()
          commit(layout.ratio + delta)
        }
      }}
    />
  )
}
