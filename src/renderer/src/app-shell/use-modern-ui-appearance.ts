// Jose fork-local: keeps the Modern UI <html> attributes in sync with settings.
import { useEffect } from 'react'
import { normalizeModernUiSettings } from '../../../shared/modern-ui-settings'
import { subscribeToPublishedTerminalViewColors } from '../components/terminal-pane/terminal-view-attributes-publisher'
import { applyModernUiAppearance, cacheModernUiSettings } from '../lib/modern-ui-appearance'
import { useAppStore } from '../store'

export function useModernUiAppearance(): void {
  const settingsLoaded = useAppStore((s) => s.settings != null)
  const modernUi = useAppStore((s) => s.settings?.modernUi)
  const modernUiTabStyle = useAppStore((s) => s.settings?.modernUiTabStyle)
  const modernUiDensity = useAppStore((s) => s.settings?.modernUiDensity)
  const modernUiFrostedGlass = useAppStore((s) => s.settings?.modernUiFrostedGlass)
  const modernUiFrostedGlassOpacity = useAppStore((s) => s.settings?.modernUiFrostedGlassOpacity)
  const modernUiUppercaseHeaders = useAppStore((s) => s.settings?.modernUiUppercaseHeaders)

  useEffect(() => {
    // Why: before hydration keep what boot applied from the cache instead of flashing defaults.
    if (!settingsLoaded) {
      return
    }
    const settings = normalizeModernUiSettings({
      modernUi,
      modernUiTabStyle,
      modernUiDensity,
      modernUiFrostedGlass,
      modernUiFrostedGlassOpacity,
      modernUiUppercaseHeaders
    })
    applyModernUiAppearance(settings)
    cacheModernUiSettings(settings)
  }, [
    settingsLoaded,
    modernUi,
    modernUiTabStyle,
    modernUiDensity,
    modernUiFrostedGlass,
    modernUiFrostedGlassOpacity,
    modernUiUppercaseHeaders
  ])

  // Why: connected tabs paint the active terminal tab in the terminal's own background.
  useEffect(
    () =>
      subscribeToPublishedTerminalViewColors(({ background }) => {
        if (background) {
          document.documentElement.style.setProperty('--modern-ui-terminal-background', background)
        }
      }),
    []
  )
}
