import React from 'react'
import { ChevronDown, CircleHelp, GitBranch, Network, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { GitHistoryScope } from '../../../../../../shared/git-history'
import { translate } from '@/i18n/i18n'

const HEADER_ICON_BUTTON_CLASS =
  'my-auto h-auto w-auto p-0.5 hover:bg-transparent dark:hover:bg-transparent [&_svg]:size-3'
const HEADER_ICON_BUTTON_MUTED_CLASS = 'text-muted-foreground hover:text-muted-foreground'

/** The Commits dock title row: collapse, graph scope, the refs explainer and refresh. */
export function GitHistoryPanelHeader({
  collapsed,
  count,
  hasCounts,
  hasMore,
  loading,
  scope,
  onToggle,
  onToggleScope,
  onRefresh
}: {
  collapsed: boolean
  count: number
  hasCounts: boolean
  hasMore: boolean
  loading: boolean
  scope: GitHistoryScope
  onToggle: () => void
  onToggleScope: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const scopeLabel =
    scope === 'all'
      ? translate(
          'auto.components.right.sidebar.GitHistoryPanel.5c8b41e7a0',
          'Graphing all branches. Click to graph the current branch only.'
        )
      : translate(
          'auto.components.right.sidebar.GitHistoryPanel.b207d94f1c',
          'Graphing the current branch. Click to graph all branches.'
        )

  return (
    <div className="h-7 pl-1 pr-3">
      <div className="flex h-full items-stretch rounded-md pr-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 px-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground/70"
          onClick={onToggle}
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')}
          />
          <span>
            {translate('auto.components.right.sidebar.GitHistoryPanel.d836037d02', 'Commits')}
          </span>
          {hasCounts && <span className="text-[10px] font-medium tabular-nums">{count}</span>}
          {hasMore && <span className="text-[10px] font-medium">+</span>}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                HEADER_ICON_BUTTON_CLASS,
                scope === 'all'
                  ? 'text-foreground hover:text-foreground'
                  : HEADER_ICON_BUTTON_MUTED_CLASS
              )}
              aria-pressed={scope === 'all'}
              aria-label={translate(
                'auto.components.right.sidebar.GitHistoryPanel.3fa10c7d55',
                'All branches'
              )}
              onClick={(event) => {
                event.stopPropagation()
                if (collapsed) {
                  onToggle()
                  return
                }
                onToggleScope()
              }}
            >
              {scope === 'all' ? (
                <Network className="size-3.5" />
              ) : (
                <GitBranch className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
            {scopeLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(HEADER_ICON_BUTTON_CLASS, HEADER_ICON_BUTTON_MUTED_CLASS)}
              aria-label={translate(
                'auto.components.right.sidebar.GitHistoryPanel.9289ba0cb9',
                'What are refs?'
              )}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <CircleHelp className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
            {translate(
              'auto.components.right.sidebar.GitHistoryPanel.9f7535d22b',
              'Refs are branch or tag names pointing at that exact commit. They only appear where Git has a named ref for the commit.'
            )}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(HEADER_ICON_BUTTON_CLASS, HEADER_ICON_BUTTON_MUTED_CLASS)}
              onClick={(event) => {
                event.stopPropagation()
                if (collapsed) {
                  onToggle()
                  return
                }
                onRefresh()
              }}
              aria-label={translate(
                'auto.components.right.sidebar.GitHistoryPanel.d0fb0f4bf2',
                'Refresh commits'
              )}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate(
              'auto.components.right.sidebar.GitHistoryPanel.d0fb0f4bf2',
              'Refresh commits'
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
