import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiffLineCounts } from '@/components/right-sidebar/source-control/listing/diff-line-counts'
import type { GitFileStatus } from '../../../../shared/git-status-types'
import type { DiffLineStat } from './changes-file-diff'

const STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: 'var(--git-decoration-modified)',
  added: 'var(--git-decoration-added)',
  untracked: 'var(--git-decoration-untracked)',
  deleted: 'var(--git-decoration-deleted)',
  renamed: 'var(--git-decoration-renamed)',
  copied: 'var(--git-decoration-copied)'
}

export function ChangesFileCollapseButton({
  path,
  status,
  collapsed,
  onToggle
}: {
  path: string
  status: GitFileStatus
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={collapsed ? `Expand ${path}` : `Collapse ${path}`}
      aria-expanded={!collapsed}
      style={{ color: STATUS_COLOR[status] }}
      onClick={onToggle}
    >
      {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </Button>
  )
}

/** Why the body is missing, or the action that loads it; null once the diff shows. */
export type ChangesFileNotice =
  | { kind: 'loading' }
  | { kind: 'deferred' }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'error'; message: string }
  | null

function NoticeText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="truncate text-xs text-muted-foreground">{children}</span>
}

export function ChangesFileHeaderMeta({
  path,
  stat,
  notice,
  onLoad
}: {
  path: string
  stat: DiffLineStat | null
  notice: ChangesFileNotice
  onLoad: () => void
}): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {notice?.kind === 'loading' ? <NoticeText>Loading…</NoticeText> : null}
      {notice?.kind === 'binary' ? <NoticeText>Binary file</NoticeText> : null}
      {notice?.kind === 'too-large' ? <NoticeText>Too large to show</NoticeText> : null}
      {notice?.kind === 'error' ? <NoticeText>{notice.message}</NoticeText> : null}
      {notice?.kind === 'deferred' || notice?.kind === 'error' ? (
        <Button type="button" variant="ghost" size="xs" onClick={onLoad}>
          {notice.kind === 'error' ? 'Retry' : 'Load diff'}
        </Button>
      ) : null}
      {stat ? <DiffLineCounts added={stat.additions} removed={stat.deletions} size="sm" /> : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy path ${path}`}
        onClick={() => {
          void window.api.ui.writeClipboardText(path).catch((error) => {
            console.error('Failed to copy diff path:', error)
          })
        }}
      >
        <Copy className="size-3" />
      </Button>
    </span>
  )
}
