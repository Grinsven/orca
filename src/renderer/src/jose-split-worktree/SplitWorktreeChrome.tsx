import { createPortal } from 'react-dom'
import { useSplitWorktreeState } from './split-worktree-state'
import { splitHalfRect } from './split-worktree-drop-zones'
import { SplitWorktreeDivider } from './SplitWorktreeDivider'

export function SplitWorktreeChrome(): React.JSX.Element {
  const { dragging, preview, pending, ownershipUnconfirmed } = useSplitWorktreeState()
  const half = preview?.edge ? splitHalfRect(preview.rect, preview.edge) : null
  return (
    <>
      <SplitWorktreeDivider />
      {(pending || ownershipUnconfirmed) && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 text-sm text-foreground"
          role="status"
          aria-busy={pending}
        >
          {ownershipUnconfirmed
            ? 'Waiting for workspace ownership to reconnect'
            : 'Updating workspace view'}
        </div>
      )}
      {dragging &&
        preview &&
        createPortal(
          <div data-jose-split-drag-shield="" className="fixed z-30" style={preview.rect}>
            {half && (
              <div
                data-jose-split-drop-preview={preview.edge ?? undefined}
                className="absolute flex items-center justify-center border border-ring bg-accent/60 text-accent-foreground"
                style={{
                  left: half.left - preview.rect.left,
                  top: half.top - preview.rect.top,
                  width: half.width,
                  height: half.height
                }}
              >
                <span className="rounded-md bg-popover px-3 py-1 text-sm text-popover-foreground shadow-xs">
                  {preview.label}
                </span>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
