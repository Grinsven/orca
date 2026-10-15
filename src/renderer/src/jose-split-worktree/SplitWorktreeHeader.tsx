import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { hasCustomTitleBar, WINDOW_CONTROLS_WIDTH } from '@/app-shell/app-window-chrome'
import { closeSplitWorktree } from './split-worktree-actions'
import { useSplitWorktreeState } from './split-worktree-state'

export function SplitWorktreeHeader({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const layout = useSplitWorktreeState((state) => state.layout)
  const pending = useSplitWorktreeState((state) => state.pending)
  const active = useAppStore((state) => state.activeWorktreeId === worktreeId)
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const slot = layout?.slots.find((ref) => ref.worktreeId === worktreeId)
  const reserveWindowControls =
    hasCustomTitleBar &&
    !rightSidebarOpen &&
    layout?.slots[layout.axis === 'horizontal' ? 1 : 0].worktreeId === worktreeId
  const name = useAppStore((state) => {
    const worktree = state.getKnownWorktreeById(worktreeId, slot?.executionHostId)
    const folder = worktreeId.startsWith('folder:')
      ? state.folderWorkspaces.find((row) => `folder:${row.id}` === worktreeId)
      : undefined
    return worktree?.displayName || worktree?.branch || folder?.name || 'Workspace'
  })
  if (!slot) {
    return null
  }
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card px-2 text-xs text-card-foreground data-[focused=true]:bg-accent data-[focused=true]:text-accent-foreground"
      data-jose-split-header={worktreeId}
      data-focused={active ? 'true' : 'false'}
    >
      <span className="min-w-0 flex-1 truncate" aria-current={active ? 'true' : undefined}>
        {name}
      </span>
      {slot.executionHostId !== 'local' && (
        <span className="truncate text-muted-foreground">{slot.executionHostId}</span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${name} split`}
        disabled={pending}
        onClick={() => void closeSplitWorktree(worktreeId)}
      >
        <X />
      </Button>
      {reserveWindowControls && (
        <div aria-hidden className="shrink-0" style={{ width: WINDOW_CONTROLS_WIDTH }} />
      )}
    </div>
  )
}
