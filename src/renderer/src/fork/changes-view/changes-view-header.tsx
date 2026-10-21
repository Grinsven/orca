import type { ComponentProps } from 'react'
import { ArrowRight } from 'lucide-react'
import { DiffLineCounts } from '@/components/right-sidebar/source-control/listing/diff-line-counts'
import type { ChangesScope } from './changes-file-entries'
import type { DiffLineStat } from './changes-file-diff'
import { ChangesScopeMenu } from './changes-scope-menu'
import { ChangesViewToolbar } from './changes-view-toolbar'

export function ChangesViewHeader({
  scope,
  baseRef,
  fileCount,
  totals,
  totalsComplete,
  onScopeChange,
  toolbar
}: {
  scope: ChangesScope
  baseRef: string | null
  fileCount: number
  totals: DiffLineStat
  /** False while some files are still loading, so the totals are a floor. */
  totalsComplete: boolean
  onScopeChange: (scope: ChangesScope) => void
  toolbar: ComponentProps<typeof ChangesViewToolbar>
}): React.JSX.Element {
  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3"
      data-changes-view-header=""
    >
      <div className="flex min-w-0 items-center gap-2">
        <ChangesScopeMenu scope={scope} baseRef={baseRef} onScopeChange={onScopeChange} />
        {scope === 'branch' && baseRef ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">HEAD</span>
            <ArrowRight className="size-3 shrink-0" />
            <span className="truncate">{baseRef}</span>
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {fileCount === 1 ? '1 file' : `${fileCount} files`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="flex items-center"
          data-changes-view-totals={totalsComplete ? 'complete' : 'partial'}
        >
          <DiffLineCounts added={totals.additions} removed={totals.deletions} size="sm" />
        </span>
        <ChangesViewToolbar {...toolbar} />
      </div>
    </div>
  )
}
