// Jose fork-local: settings for the VS Code style "Modern UI" look (floating cards, refreshed
// tabs, normal-case headers, frosted overlays). Not for upstream.
import type { SourceControlHistorySettings } from './git-history-types'
import { isJoseUiVariant, type JoseUiVariant } from './fork/jose-ui-variant'
import type { TerminalCursorGlideSettings } from './fork/terminal-cursor-glide-settings'

export type ModernUiTabStyle = 'connected' | 'pill'
export type ModernUiDensity = 'default' | 'compact'

export type ModernUiSettings = {
  joseUiVariant?: JoseUiVariant
  modernUi: boolean
  modernUiTabStyle: ModernUiTabStyle
  modernUiDensity: ModernUiDensity
  modernUiFrostedGlass: boolean
  /** Tint opacity of frosted overlays in percent; lower shows more of the blurred backdrop. */
  modernUiFrostedGlassOpacity: number
  modernUiUppercaseHeaders: boolean
}

/** GlobalSettings' trailing intersection, defined here because global-settings-types.ts sits at its
 *  max-lines ceiling and cannot take another import line. */
export type SourceControlHistoryAndModernUiSettings = SourceControlHistorySettings &
  ModernUiSettings &
  TerminalCursorGlideSettings

type ModernUiSettingsSource = Partial<Record<keyof ModernUiSettings, unknown>>

export const MODERN_UI_GLASS_OPACITY_MIN = 50
export const MODERN_UI_GLASS_OPACITY_MAX = 100
export const MODERN_UI_GLASS_OPACITY_DEFAULT = 80

export const DEFAULT_MODERN_UI_SETTINGS: ModernUiSettings = {
  modernUi: true,
  modernUiTabStyle: 'connected',
  modernUiDensity: 'default',
  modernUiFrostedGlass: true,
  modernUiFrostedGlassOpacity: MODERN_UI_GLASS_OPACITY_DEFAULT,
  modernUiUppercaseHeaders: false
}

const MODERN_UI_SETTING_KEYS = [
  'modernUi',
  'modernUiTabStyle',
  'modernUiDensity',
  'modernUiFrostedGlass',
  'modernUiFrostedGlassOpacity',
  'modernUiUppercaseHeaders'
] as const satisfies readonly (keyof ModernUiSettings)[]

export function normalizeModernUiGlassOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return MODERN_UI_GLASS_OPACITY_DEFAULT
  }
  return Math.min(
    MODERN_UI_GLASS_OPACITY_MAX,
    Math.max(MODERN_UI_GLASS_OPACITY_MIN, Math.round(value))
  )
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Full Modern UI settings from a persisted or hand-edited object; bad values fall back to defaults. */
export function normalizeModernUiSettings(
  source: ModernUiSettingsSource | null | undefined
): ModernUiSettings {
  const defaults = DEFAULT_MODERN_UI_SETTINGS
  return {
    ...(isJoseUiVariant(source?.joseUiVariant) ? { joseUiVariant: source.joseUiVariant } : {}),
    modernUi: booleanOr(source?.modernUi, defaults.modernUi),
    modernUiTabStyle: source?.modernUiTabStyle === 'pill' ? 'pill' : 'connected',
    modernUiDensity: source?.modernUiDensity === 'compact' ? 'compact' : 'default',
    modernUiFrostedGlass: booleanOr(source?.modernUiFrostedGlass, defaults.modernUiFrostedGlass),
    modernUiFrostedGlassOpacity: normalizeModernUiGlassOpacity(source?.modernUiFrostedGlassOpacity),
    modernUiUppercaseHeaders: booleanOr(
      source?.modernUiUppercaseHeaders,
      defaults.modernUiUppercaseHeaders
    )
  }
}

/** Same as normalizeModernUiSettings for values of unknown shape, such as parsed JSON. */
export function parseModernUiSettings(value: unknown): ModernUiSettings {
  return normalizeModernUiSettings(typeof value === 'object' && value !== null ? value : null)
}

function copyModernUiSetting<K extends keyof ModernUiSettings>(
  target: Partial<ModernUiSettings>,
  source: ModernUiSettings,
  key: K
): void {
  target[key] = source[key]
}

/** Only the Modern UI keys present in a settings write, coerced so no stray type persists. */
export function sanitizeModernUiSettingsUpdate(
  updates: ModernUiSettingsSource
): Partial<ModernUiSettings> {
  // Why `=== true` for writes: like showMenuBarIcon, a truthy non-boolean must not turn a flag on.
  const normalized = normalizeModernUiSettings({
    ...updates,
    modernUi: updates.modernUi === true,
    modernUiFrostedGlass: updates.modernUiFrostedGlass === true,
    modernUiUppercaseHeaders: updates.modernUiUppercaseHeaders === true
  })
  const sanitized: Partial<ModernUiSettings> = {}
  for (const key of MODERN_UI_SETTING_KEYS) {
    if (key in updates) {
      copyModernUiSetting(sanitized, normalized, key)
    }
  }
  return sanitized
}
