import type { ClaudeStatusLineContext } from '../../shared/claude-statusline-rate-limits'

export type ClaudeStatuslineContextEvent = { paneKey: string | null } & Pick<
  ClaudeStatusLineContext,
  'model' | 'usedPercent'
>

export type ClaudeStatuslineApi = {
  /** Latest Claude context usage forwarded from the statusline ingest endpoint. */
  onContext: (callback: (data: ClaudeStatuslineContextEvent) => void) => () => void
}
