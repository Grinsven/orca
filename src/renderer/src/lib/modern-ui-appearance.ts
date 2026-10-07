// Jose fork-local: mirrors the Modern UI settings onto <html> so modern-ui*.css can key off them.
import { parseModernUiSettings, type ModernUiSettings } from '../../../shared/modern-ui-settings'

const MODERN_UI_CACHE_KEY = 'orca-modern-ui-settings'

type ModernUiRoot = {
  dataset: DOMStringMap
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
}

type ModernUiStorage = Pick<Storage, 'getItem' | 'setItem'>

function setFlag(dataset: DOMStringMap, key: string, on: boolean): void {
  if (on) {
    dataset[key] = 'on'
  } else {
    delete dataset[key]
  }
}

export function applyModernUiAppearance(
  settings: ModernUiSettings,
  root: ModernUiRoot = document.documentElement
): void {
  const { dataset, style } = root
  // Why: every attribute is dropped when off so no Modern UI rule can match and the app looks stock.
  setFlag(dataset, 'modernUi', settings.modernUi)
  setFlag(dataset, 'modernUiGlass', settings.modernUi && settings.modernUiFrostedGlass)
  setFlag(dataset, 'modernUiUppercase', settings.modernUi && settings.modernUiUppercaseHeaders)
  if (!settings.modernUi) {
    delete dataset.modernUiTabs
    delete dataset.modernUiDensity
    style.removeProperty('--modern-ui-glass-opacity')
    return
  }
  dataset.modernUiTabs = settings.modernUiTabStyle
  dataset.modernUiDensity = settings.modernUiDensity
  style.setProperty('--modern-ui-glass-opacity', `${settings.modernUiFrostedGlassOpacity}%`)
}

function defaultStorage(): ModernUiStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Last applied settings, so boot can paint the right shell before settings hydrate. */
export function readCachedModernUiSettings(
  storage: ModernUiStorage | null = defaultStorage()
): ModernUiSettings {
  try {
    const raw = storage?.getItem(MODERN_UI_CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parseModernUiSettings(parsed)
  } catch {
    return parseModernUiSettings(null)
  }
}

export function cacheModernUiSettings(
  settings: ModernUiSettings,
  storage: ModernUiStorage | null = defaultStorage()
): void {
  try {
    storage?.setItem(MODERN_UI_CACHE_KEY, JSON.stringify(settings))
  } catch {
    // Best effort: without the cache the next boot paints defaults until settings load.
  }
}

export function applyCachedModernUiAppearance(): void {
  applyModernUiAppearance(readCachedModernUiSettings())
}
