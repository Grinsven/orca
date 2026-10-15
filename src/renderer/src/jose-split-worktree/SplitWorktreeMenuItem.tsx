import { useAppStore } from '@/store'
import { Columns2 } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { Worktree } from '../../../shared/worktree/types'
import { openSplitWorktree, splitWorkspaceFromRow } from './split-worktree-actions'
import { useSplitPreference } from './split-worktree-preference'

export function SplitWorktreeMenuItem({
  worktree,
  disabled
}: {
  worktree: Worktree
  disabled?: boolean
}): React.JSX.Element | null {
  const hasActiveWorkspace = useAppStore((state) => state.activeWorktreeId !== null)
  const ready = useSplitPreference((state) => state.ready)
  if (!window.joseWindow) {
    return null
  }
  return (
    <DropdownMenuItem
      disabled={disabled || !ready || !hasActiveWorkspace}
      onSelect={() => {
        const source = splitWorkspaceFromRow(worktree)
        if (source) {
          void openSplitWorktree(source, 'right')
        }
      }}
    >
      <Columns2 />
      Open beside current workspace
    </DropdownMenuItem>
  )
}
