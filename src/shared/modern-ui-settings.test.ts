import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  DEFAULT_MODERN_UI_SETTINGS,
  normalizeModernUiGlassOpacity,
  normalizeModernUiSettings,
  parseModernUiSettings,
  sanitizeModernUiSettingsUpdate
} from './modern-ui-settings'

describe('Modern UI defaults', () => {
  it('ships on, connected, default density, glass at 80% and normal-case headers', () => {
    expect(DEFAULT_MODERN_UI_SETTINGS).toEqual({
      modernUi: true,
      modernUiTabStyle: 'connected',
      modernUiDensity: 'default',
      modernUiFrostedGlass: true,
      modernUiFrostedGlassOpacity: 80,
      modernUiUppercaseHeaders: false
    })
  })

  it('is part of the global default settings', () => {
    expect(getDefaultSettings('/tmp')).toMatchObject(DEFAULT_MODERN_UI_SETTINGS)
  })
})

describe('normalizeModernUiSettings', () => {
  it('fills missing keys from an older profile with the defaults', () => {
    expect(normalizeModernUiSettings({})).toEqual(DEFAULT_MODERN_UI_SETTINGS)
    expect(normalizeModernUiSettings(undefined)).toEqual(DEFAULT_MODERN_UI_SETTINGS)
  })

  it('keeps valid explicit choices', () => {
    const custom = {
      modernUi: false,
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUiFrostedGlass: false,
      modernUiFrostedGlassOpacity: 65,
      modernUiUppercaseHeaders: true
    } as const
    expect(normalizeModernUiSettings(custom)).toEqual(custom)
  })

  it('replaces unknown enum values and non-boolean flags with the defaults', () => {
    expect(
      normalizeModernUiSettings({
        modernUi: 'yes',
        modernUiTabStyle: 'rounded',
        modernUiDensity: 'tight',
        modernUiFrostedGlass: 1,
        modernUiUppercaseHeaders: null
      })
    ).toEqual(DEFAULT_MODERN_UI_SETTINGS)
  })

  it('reads JSON of unknown shape', () => {
    expect(parseModernUiSettings('nope')).toEqual(DEFAULT_MODERN_UI_SETTINGS)
    expect(parseModernUiSettings({ modernUiTabStyle: 'pill' }).modernUiTabStyle).toBe('pill')
  })
})

describe('normalizeModernUiGlassOpacity', () => {
  it('clamps to 50..100 and rounds to whole percents', () => {
    expect(normalizeModernUiGlassOpacity(20)).toBe(50)
    expect(normalizeModernUiGlassOpacity(150)).toBe(100)
    expect(normalizeModernUiGlassOpacity(72.6)).toBe(73)
    expect(normalizeModernUiGlassOpacity(50)).toBe(50)
    expect(normalizeModernUiGlassOpacity(100)).toBe(100)
  })

  it('falls back to 80 for values that are not finite numbers', () => {
    expect(normalizeModernUiGlassOpacity('90')).toBe(80)
    expect(normalizeModernUiGlassOpacity(Number.NaN)).toBe(80)
    expect(normalizeModernUiGlassOpacity(Number.POSITIVE_INFINITY)).toBe(80)
    expect(normalizeModernUiGlassOpacity(undefined)).toBe(80)
  })
})

describe('sanitizeModernUiSettingsUpdate', () => {
  it('returns only the Modern UI keys that the write contains', () => {
    expect(sanitizeModernUiSettingsUpdate({ modernUiTabStyle: 'pill' })).toEqual({
      modernUiTabStyle: 'pill'
    })
    expect(sanitizeModernUiSettingsUpdate({})).toEqual({})
  })

  it('coerces bad values in a write instead of persisting them; only true turns a flag on', () => {
    expect(
      sanitizeModernUiSettingsUpdate({
        modernUi: 'false',
        modernUiDensity: 'huge',
        modernUiFrostedGlassOpacity: 12
      })
    ).toEqual({ modernUi: false, modernUiDensity: 'default', modernUiFrostedGlassOpacity: 50 })
  })
})
