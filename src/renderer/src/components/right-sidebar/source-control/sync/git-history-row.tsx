import React from 'react'
import { ChevronDown, Cloud, FolderGit2, GitBranch, Tag } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { GitHistoryItem, GitHistoryItemRef } from '../../../../../../shared/git-history'
import type { GitHistoryItemViewModel } from '../../../../../../shared/git-history-graph'
import { GitHistoryGraphSvg, graphColor } from './git-history-graph-svg'
import { dedupeRemoteTrackingRefs } from '../../../../../../shared/git-history-ref-display'
import type { GitHistoryWorktreeRef } from '../../../../../../shared/git-history-worktree-refs'
import { translate } from '@/i18n/i18n'

const GIT_HISTORY_REF_ICONS = {
  branches: GitBranch,
  'remote branches': Cloud,
  tags: Tag,
  commits: GitBranch
} as const

function GitHistoryRefBadge({
  itemRef,
  worktree
}: {
  itemRef: GitHistoryItemRef
  worktree?: GitHistoryWorktreeRef
}): React.JSX.Element {
  const refLabel = itemRef.category ? `${itemRef.name} (${itemRef.category})` : itemRef.name
  const RefIcon = GIT_HISTORY_REF_ICONS[itemRef.category ?? 'commits']
  const refColor = itemRef.color ? graphColor(itemRef.color) : undefined

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex max-w-[8rem] items-center gap-0.5 rounded-full border bg-sidebar px-1.5 py-0.5 text-[10px] leading-none"
          style={{
            borderColor: refColor ?? 'var(--border)',
            color: refColor ?? 'var(--muted-foreground)'
          }}
        >
          <RefIcon aria-hidden="true" className="size-2.5 shrink-0" />
          <span className="truncate">{itemRef.name}</span>
          {worktree && (
            <FolderGit2
              aria-hidden="true"
              data-testid="git-history-ref-worktree"
              className="size-2.5 shrink-0"
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
        {worktree
          ? translate(
              'auto.components.right.sidebar.GitHistoryRow.7b3c05e214',
              '{{value0}}. Checked out in workspace {{value1}}; right-click the row to open it.',
              { value0: refLabel, value1: worktree.displayName }
            )
          : refLabel}
      </TooltipContent>
    </Tooltip>
  )
}

type GitHistoryRowProps = React.HTMLAttributes<HTMLElement> & {
  viewModel: GitHistoryItemViewModel
  expanded?: boolean
  preserveRefIds?: readonly string[]
  worktreesByBranch?: ReadonlyMap<string, GitHistoryWorktreeRef>
  onOpenCommit?: (item: GitHistoryItem) => void
  onToggleExpand?: (item: GitHistoryItem) => void
}

export const GitHistoryRow = React.forwardRef<HTMLElement, GitHistoryRowProps>(
  function GitHistoryRow(
    {
      viewModel,
      expanded = false,
      preserveRefIds,
      worktreesByBranch,
      onOpenCommit,
      onToggleExpand,
      className,
      ...rootProps
    },
    ref
  ): React.JSX.Element {
    const item = viewModel.historyItem
    const isBoundaryNode =
      viewModel.kind === 'incoming-changes' || viewModel.kind === 'outgoing-changes'
    // Expanding to an inline file list is the primary click; opening the combined
    // diff stays reachable from the expanded list. Fall back to open-all when no
    // expand handler is wired so the row still does something useful.
    const canExpand = !isBoundaryNode && Boolean(onToggleExpand)
    const canOpenCommit = !isBoundaryNode && Boolean(onOpenCommit)
    const isInteractive = canExpand || canOpenCommit
    // A local branch and its own remote-tracking ref at the same commit are
    // redundant, so collapse the pair to one pill.
    const refs = dedupeRemoteTrackingRefs(item.references ?? [], { preserveRefIds })
    const visibleRefs = refs.slice(0, 2)
    const hiddenRefs = refs.slice(2)
    const rowTooltip = item.message || item.subject
    const rowClassName = cn(
      'grid min-h-[26px] w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 px-3 py-0.5 text-left text-xs transition-colors',
      isInteractive && 'cursor-pointer hover:bg-accent/40 focus-visible:bg-accent/40',
      !isInteractive && 'cursor-default',
      isBoundaryNode && 'text-muted-foreground',
      className
    )
    const rowContent = (
      <>
        <GitHistoryGraphSvg viewModel={viewModel} />
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {canExpand && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform',
                !expanded && '-rotate-90'
              )}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block min-w-0 flex-1 truncate text-foreground">{item.subject}</span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={6}
              collisionPadding={8}
              className="max-w-[min(76ch,var(--radix-tooltip-content-available-width))] break-words text-wrap whitespace-pre-wrap"
            >
              {rowTooltip}
            </TooltipContent>
          </Tooltip>
        </div>
        {refs.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 overflow-hidden">
            {visibleRefs.map((ref) => (
              <GitHistoryRefBadge
                key={ref.id}
                itemRef={ref}
                worktree={
                  ref.category === 'branches' ? worktreesByBranch?.get(ref.name) : undefined
                }
              />
            ))}
            {hiddenRefs.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
                    +{hiddenRefs.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
                  {hiddenRefs.map((ref) => ref.name).join(', ')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </>
    )

    if (!isInteractive) {
      return (
        <div
          {...rootProps}
          ref={ref as React.Ref<HTMLDivElement>}
          className={rowClassName}
          data-testid="git-history-row"
        >
          {rowContent}
        </div>
      )
    }

    const handleClick = (): void => {
      if (canExpand) {
        onToggleExpand?.(item)
        return
      }
      onOpenCommit?.(item)
    }

    return (
      <button
        {...rootProps}
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={rowClassName}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={
          canExpand
            ? expanded
              ? translate(
                  'auto.components.right.sidebar.GitHistoryRow.4a8d9e0c1f',
                  'Hide files in commit {{value0}}: {{value1}}',
                  { value0: item.displayId ?? item.id, value1: item.subject }
                )
              : translate(
                  'auto.components.right.sidebar.GitHistoryRow.2f9c41ab07',
                  'Show files in commit {{value0}}: {{value1}}',
                  { value0: item.displayId ?? item.id, value1: item.subject }
                )
            : translate(
                'auto.components.right.sidebar.GitHistoryPanel.8232c8b2f2',
                'Open commit {{value0}}: {{value1}}',
                { value0: item.displayId ?? item.id, value1: item.subject }
              )
        }
        data-testid="git-history-row"
        onClick={handleClick}
      >
        {rowContent}
      </button>
    )
  }
)
