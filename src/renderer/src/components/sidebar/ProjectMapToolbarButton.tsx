import { MapIcon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { openWorkspaceFilePreview } from '@/lib/workspace-file-preview-open'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { selectKnownWorktreeById, selectRepoByIdForActiveWorkspace } from '@/store/selectors'

/** Map path of the active worktree's repo; null with no active worktree, a folder workspace or no map. */
export function selectActiveProjectMapPath(state: AppState): string | null {
  const worktree = selectKnownWorktreeById(state, state.activeWorktreeId)
  if (!worktree) {
    return null
  }
  const repo = selectRepoByIdForActiveWorkspace(state, worktree.repoId)
  return repo?.projectMapPath?.trim() || null
}

export function ProjectMapToolbarButton(): React.JSX.Element | null {
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const projectMapPath = useAppStore(selectActiveProjectMapPath)
  if (!activeWorktreeId || !projectMapPath) {
    return null
  }

  const handleClick = (): void => {
    const result = openWorkspaceFilePreview({
      filePath: projectMapPath,
      worktreeId: activeWorktreeId,
      focus: true
    })
    if (result.status === 'unsupported') {
      toast.error(result.message)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={translate(
            'auto.components.sidebar.ProjectMapToolbarButton.32cb15ce9c',
            'Project map'
          )}
          data-project-map-trigger=""
          onClick={handleClick}
          className="text-muted-foreground"
        >
          <MapIcon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {translate('auto.components.sidebar.ProjectMapToolbarButton.32cb15ce9c', 'Project map')}
      </TooltipContent>
    </Tooltip>
  )
}
