import React, { useEffect, useState } from 'react'

type ClaudeContextEvent = { paneKey: string | null; model: string; usedPercent: number }

const STALE_MS = 3 * 60_000
const BAR_WIDTH = 8

// Jose fork-local: mirrors the in-TUI statusline ([model] ▓▓░ %) for the latest Claude session.
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
  const filled = Math.min(BAR_WIDTH, Math.round((event.usedPercent / 100) * BAR_WIDTH))
  const bar = '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
  return (
    <span
      className="flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground"
      title="Claude context usage (latest active session)"
    >
      [{event.model}] {bar} {event.usedPercent}%
    </span>
  )
}
