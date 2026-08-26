// Why: Claude Code (>=2.1.80) pipes `rate_limits` to the statusLine command on every
// turn — piggybacked on Messages API responses, so reading it costs no usage-endpoint
// budget (the endpoint 429s under Orca's polling; see rate-limits/service.ts).

export const CLAUDE_STATUSLINE_PATHNAME = '/statusline/claude'

// Why: the statusline ticks ~3x/sec while streaming and the service drops same-value posts
// inside LIVE_CLAUDE_INGEST_DEDUPE_MS (30s) anyway; a per-pane client floor below that bound
// keeps the usage bar live while capping curl spawns at one per pane per interval.
export const CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS = 15

export type ClaudeStatusLineWindow = {
  used_percentage?: number
  /** OAuth-usage-shaped sibling field (0-100); accepted so a CLI schema drift degrades instead of going dark. */
  utilization?: number
  /** Unix epoch seconds when the window resets, if known; tolerates an ISO/date string if the schema drifts. */
  resets_at?: number | string
}

export type ClaudeStatusLineContext = {
  model: string
  usedPercent: number
}

export type ClaudeStatusLineRateLimits = {
  /** CLAUDE_CONFIG_DIR of the reporting session; null for system-default sessions. */
  configDir: string | null
  /** ORCA_PANE_KEY of the reporting pane; null when posted outside an Orca pane. */
  paneKey: string | null
  fiveHour: ClaudeStatusLineWindow | null
  sevenDay: ClaudeStatusLineWindow | null
  /** Context-window usage of the reporting session, when the payload carries it. */
  context: ClaudeStatusLineContext | null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseWindow(value: unknown): ClaudeStatusLineWindow | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as { used_percentage?: unknown; utilization?: unknown; resets_at?: unknown }
  const usedPercentage = finiteNumber(raw.used_percentage)
  // Why: mirror mapClaudeUsageWindow's OAuth-shape tolerance (utilization, 0-100) so a statusline field rename degrades instead of silently darkening the feed.
  const utilization = usedPercentage === undefined ? finiteNumber(raw.utilization) : undefined
  if (usedPercentage === undefined && utilization === undefined) {
    return null
  }
  // Why: resets_at is epoch seconds today, but pass a string/ISO value through so schema drift degrades to a parseable timestamp (see parseClaudeUsageResetTimestamp) instead of silently dropping it.
  const resetsAt =
    typeof raw.resets_at === 'number' && Number.isFinite(raw.resets_at)
      ? raw.resets_at
      : typeof raw.resets_at === 'string' && raw.resets_at.trim()
        ? raw.resets_at
        : undefined
  return {
    ...(usedPercentage !== undefined ? { used_percentage: usedPercentage } : {}),
    ...(utilization !== undefined ? { utilization } : {}),
    resets_at: resetsAt
  }
}

/**
 * Parses the form-encoded body posted by the managed Claude statusline script.
 * Returns null when the payload carries no usable rate-limit windows.
 */
export function parseClaudeStatusLineBody(body: unknown): ClaudeStatusLineRateLimits | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const fields = body as { payload?: unknown; configDir?: unknown }
  if (typeof fields.payload !== 'string' || !fields.payload) {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(fields.payload)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const rateLimits = (payload as { rate_limits?: unknown }).rate_limits
  const hasRateLimits = typeof rateLimits === 'object' && rateLimits !== null
  const fiveHour = hasRateLimits
    ? parseWindow((rateLimits as { five_hour?: unknown }).five_hour)
    : null
  const sevenDay = hasRateLimits
    ? parseWindow((rateLimits as { seven_day?: unknown }).seven_day)
    : null
  const context = parseContextWindow(payload)
  if (!fiveHour && !sevenDay && !context) {
    return null
  }
  const configDir = typeof fields.configDir === 'string' ? fields.configDir.trim() : ''
  const paneKeyField = (fields as { paneKey?: unknown }).paneKey
  const paneKey =
    typeof paneKeyField === 'string' && paneKeyField.trim() ? paneKeyField.trim() : null
  return { configDir: configDir || null, paneKey, fiveHour, sevenDay, context }
}

// Why: mirror the common statusline math — Claude reserves default max-output headroom above input tokens.
const CONTEXT_RESERVED_OUTPUT_TOKENS = 32_000

function parseContextWindow(payload: unknown): ClaudeStatusLineContext | null {
  const root = payload as { model?: { display_name?: unknown }; context_window?: unknown }
  const window = root.context_window as
    | { context_window_size?: unknown; current_usage?: unknown }
    | undefined
  const size = finiteNumber(window?.context_window_size)
  const usage = window?.current_usage as
    | {
        input_tokens?: unknown
        cache_creation_input_tokens?: unknown
        cache_read_input_tokens?: unknown
      }
    | null
    | undefined
  if (!size || size <= 0 || typeof usage !== 'object' || usage === null) {
    return null
  }
  const model = typeof root.model?.display_name === 'string' ? root.model.display_name.trim() : ''
  if (!model) {
    return null
  }
  const tokens =
    (finiteNumber(usage.input_tokens) ?? 0) +
    (finiteNumber(usage.cache_creation_input_tokens) ?? 0) +
    (finiteNumber(usage.cache_read_input_tokens) ?? 0)
  const usedPercent = Math.max(
    0,
    Math.min(100, Math.round(((tokens + CONTEXT_RESERVED_OUTPUT_TOKENS) * 100) / size))
  )
  return { model, usedPercent }
}
