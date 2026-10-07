import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'

const MODERN_UI_KEYS = [
  'modernUi',
  'modernUiTabStyle',
  'modernUiDensity',
  'modernUiFrostedGlass',
  'modernUiFrostedGlassOpacity',
  'modernUiUppercaseHeaders'
] as const

function normalizeProfile(
  overrides: Record<string, unknown>,
  options: { dropModernUi?: boolean } = {}
): PersistedState['settings'] {
  const defaults = getDefaultPersistedState(homedir())
  const settings: Partial<GlobalSettings> = { ...defaults.settings }
  if (options.dropModernUi) {
    for (const key of MODERN_UI_KEYS) {
      delete settings[key]
    }
  }
  Object.assign(settings, overrides)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates a hand-edited or older persisted file.
  const parsed: PersistedState = { ...defaults, settings: settings as GlobalSettings }
  const noop = (): void => {}
  const terminal = prepareLoadedTerminalSettings(parsed, noop)
  const profile = prepareLoadedProfileSettings(parsed, defaults, noop)
  return normalizeLoadedGlobalSettings(parsed, terminal, profile)
}

describe('Modern UI settings on load', () => {
  it('turns Modern UI on with its defaults for profiles saved before it existed', () => {
    const normalized = normalizeProfile({}, { dropModernUi: true })
    expect(normalized).toMatchObject({
      modernUi: true,
      modernUiTabStyle: 'connected',
      modernUiDensity: 'default',
      modernUiFrostedGlass: true,
      modernUiFrostedGlassOpacity: 80,
      modernUiUppercaseHeaders: false
    })
  })

  it('keeps an explicit opt-out and the chosen details', () => {
    expect(
      normalizeProfile({
        modernUi: false,
        modernUiTabStyle: 'pill',
        modernUiDensity: 'compact',
        modernUiFrostedGlassOpacity: 64
      })
    ).toMatchObject({
      modernUi: false,
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUiFrostedGlassOpacity: 64
    })
  })

  it('repairs hand-edited values instead of passing them to the renderer', () => {
    expect(
      normalizeProfile({
        modernUi: 'on',
        modernUiTabStyle: 'tabs',
        modernUiDensity: 3,
        modernUiFrostedGlassOpacity: 7,
        modernUiUppercaseHeaders: 'true'
      })
    ).toMatchObject({
      modernUi: true,
      modernUiTabStyle: 'connected',
      modernUiDensity: 'default',
      modernUiFrostedGlassOpacity: 50,
      modernUiUppercaseHeaders: false
    })
    expect(normalizeProfile({ modernUiFrostedGlassOpacity: 400 }).modernUiFrostedGlassOpacity).toBe(
      100
    )
  })
})
