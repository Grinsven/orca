import type { ReactNode } from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FolderTree,
  Pilcrow,
  RefreshCw,
  Rows3,
  WrapText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type ChangesViewLayout = 'stacked' | 'split'

function Tip({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ChangesViewToolbar({
  layout,
  wordWrap,
  ignoreWhitespace,
  allCollapsed,
  fileTreeOpen,
  refreshing,
  onLayoutChange,
  onWordWrapChange,
  onIgnoreWhitespaceChange,
  onToggleAllCollapsed,
  onFileTreeOpenChange,
  onRefresh
}: {
  layout: ChangesViewLayout
  wordWrap: boolean
  ignoreWhitespace: boolean
  allCollapsed: boolean
  fileTreeOpen: boolean
  refreshing: boolean
  onLayoutChange: (layout: ChangesViewLayout) => void
  onWordWrapChange: (wordWrap: boolean) => void
  onIgnoreWhitespaceChange: (ignore: boolean) => void
  onToggleAllCollapsed: () => void
  onFileTreeOpenChange: (open: boolean) => void
  onRefresh: () => void
}): React.JSX.Element {
  const collapseLabel = allCollapsed ? 'Expand all files' : 'Collapse all files'
  const wrapLabel = wordWrap ? 'Disable line wrapping' : 'Enable line wrapping'
  const whitespaceLabel = ignoreWhitespace ? 'Show whitespace changes' : 'Hide whitespace changes'
  const treeLabel = fileTreeOpen ? 'Hide file tree' : 'Show file tree'
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tip label={refreshing ? 'Refreshing diff…' : 'Refresh diff'}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh diff"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </Tip>
      <Tip label={collapseLabel}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={collapseLabel}
          onClick={onToggleAllCollapsed}
        >
          {allCollapsed ? (
            <ChevronsUpDown className="size-3.5" />
          ) : (
            <ChevronsDownUp className="size-3.5" />
          )}
        </Button>
      </Tip>
      <ToggleGroup
        type="single"
        variant="segmented"
        size="xs"
        aria-label="Diff layout"
        value={layout}
        onValueChange={(value) => {
          if (value === 'stacked' || value === 'split') {
            onLayoutChange(value)
          }
        }}
      >
        <ToggleGroupItem value="stacked" aria-label="Stacked diff view">
          <Rows3 className="size-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="split" aria-label="Split diff view">
          <Columns2 className="size-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
      <Tip label={wrapLabel}>
        <Toggle
          variant="segmented"
          size="xs"
          aria-label={wrapLabel}
          pressed={wordWrap}
          onPressedChange={onWordWrapChange}
        >
          <WrapText className="size-3.5" />
        </Toggle>
      </Tip>
      <Tip label={whitespaceLabel}>
        <Toggle
          variant="segmented"
          size="xs"
          aria-label={whitespaceLabel}
          pressed={ignoreWhitespace}
          onPressedChange={onIgnoreWhitespaceChange}
        >
          <Pilcrow className="size-3.5" />
        </Toggle>
      </Tip>
      <Tip label={treeLabel}>
        <Toggle
          variant="segmented"
          size="xs"
          aria-label={treeLabel}
          pressed={fileTreeOpen}
          onPressedChange={onFileTreeOpenChange}
        >
          <FolderTree className="size-3.5" />
        </Toggle>
      </Tip>
    </div>
  )
}
