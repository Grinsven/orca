// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODERN_UI_SETTINGS } from '../../../shared/modern-ui-settings'
import {
  applyCachedModernUiAppearance,
  applyModernUiAppearance,
  cacheModernUiSettings,
  readCachedModernUiSettings
} from './modern-ui-appearance'

const root = document.documentElement

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

afterEach(() => {
  applyModernUiAppearance({ ...DEFAULT_MODERN_UI_SETTINGS, modernUi: false })
  window.localStorage.clear()
})

describe('applyModernUiAppearance', () => {
  it('sets every attribute and the glass opacity when on', () => {
    applyModernUiAppearance(DEFAULT_MODERN_UI_SETTINGS)

    expect(root.getAttribute('data-modern-ui')).toBe('on')
    expect(root.getAttribute('data-modern-ui-tabs')).toBe('connected')
    expect(root.getAttribute('data-modern-ui-density')).toBe('default')
    expect(root.getAttribute('data-modern-ui-glass')).toBe('on')
    expect(root.hasAttribute('data-modern-ui-uppercase')).toBe(false)
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('80%')
  })

  it('reflects each detail setting', () => {
    applyModernUiAppearance({
      modernUi: true,
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUiFrostedGlass: false,
      modernUiFrostedGlassOpacity: 55,
      modernUiUppercaseHeaders: true
    })

    expect(root.getAttribute('data-modern-ui-tabs')).toBe('pill')
    expect(root.getAttribute('data-modern-ui-density')).toBe('compact')
    expect(root.hasAttribute('data-modern-ui-glass')).toBe(false)
    expect(root.getAttribute('data-modern-ui-uppercase')).toBe('on')
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('55%')
  })

  it('removes every attribute when off so the stock look returns', () => {
    applyModernUiAppearance({ ...DEFAULT_MODERN_UI_SETTINGS, modernUiUppercaseHeaders: true })
    applyModernUiAppearance({ ...DEFAULT_MODERN_UI_SETTINGS, modernUi: false })

    for (const name of [
      'data-modern-ui',
      'data-modern-ui-tabs',
      'data-modern-ui-density',
      'data-modern-ui-glass',
      'data-modern-ui-uppercase'
    ]) {
      expect(root.hasAttribute(name)).toBe(false)
    }
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('')
  })
})

describe('Modern UI boot cache', () => {
  it('round-trips the last applied settings', () => {
    const storage = memoryStorage()
    const settings = { ...DEFAULT_MODERN_UI_SETTINGS, modernUiTabStyle: 'pill' as const }
    cacheModernUiSettings(settings, storage)

    expect(readCachedModernUiSettings(storage)).toEqual(settings)
  })

  it('falls back to the defaults when the cache is empty, corrupt or unreadable', () => {
    const corrupt = memoryStorage()
    corrupt.setItem('orca-modern-ui-settings', '{not json')
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: (): void => {
        throw new Error('blocked')
      }
    }

    expect(readCachedModernUiSettings(memoryStorage())).toEqual(DEFAULT_MODERN_UI_SETTINGS)
    expect(readCachedModernUiSettings(corrupt)).toEqual(DEFAULT_MODERN_UI_SETTINGS)
    expect(readCachedModernUiSettings(throwing)).toEqual(DEFAULT_MODERN_UI_SETTINGS)
    expect(() => cacheModernUiSettings(DEFAULT_MODERN_UI_SETTINGS, throwing)).not.toThrow()
    expect(readCachedModernUiSettings(null)).toEqual(DEFAULT_MODERN_UI_SETTINGS)
  })

  it('applies the cached choice at boot, before settings hydrate', () => {
    cacheModernUiSettings({ ...DEFAULT_MODERN_UI_SETTINGS, modernUi: false })
    applyModernUiAppearance(DEFAULT_MODERN_UI_SETTINGS)

    applyCachedModernUiAppearance()

    expect(root.hasAttribute('data-modern-ui')).toBe(false)
  })
})
