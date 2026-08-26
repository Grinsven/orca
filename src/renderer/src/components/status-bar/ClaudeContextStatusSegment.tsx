import React, { useEffect, useState } from 'react'

type ClaudeContextEvent = { paneKey: string | null; model: string; usedPercent: number }

const STALE_MS = 3 * 60_000

// Jose fork-local: mirrors the in-TUI statusline (model + context bar) for the latest Claude session.
export function ClaudeContextStatusSegment(): React.JSX.Element | null {
  const [event, setEvent] = useState<(ClaudeContextEvent & { at: number }) | null>(null)
  const [, setTick] = useState(0)

  useEffect(
    () => window.api.claudeStatusline.onContext((data) => setEvent({ ...data, at: Date.now() })),
    []
  )
  // Why: re-render on a slow clock so a finished session's segment ages out without new events.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!event || Date.now() - event.at > STALE_MS) {
    return null
  }
  const percent = Math.max(0, Math.min(100, event.usedPercent))
  const fillColor =
    percent >= 85
      ? 'var(--destructive)'
      : percent >= 60
        ? 'var(--warning, #f59e0b)'
        : 'var(--status-success)'
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs text-foreground"
      title="Claude context usage (latest active session)"
    >
      <span className="text-muted-foreground">{event.model}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: fillColor }}
        />
      </span>
      <span className="tabular-nums">{percent}%</span>
    </span>
  )
}
