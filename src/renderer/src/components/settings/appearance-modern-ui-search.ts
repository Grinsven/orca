// Jose fork-local: search metadata for the Modern UI group in Appearance > Interface.
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

type ModernUiSettingEntries = {
  modernUi: SettingsSearchEntry
  tabStyle: SettingsSearchEntry
  density: SettingsSearchEntry
  uppercaseHeaders: SettingsSearchEntry
  frostedGlass: SettingsSearchEntry
  glassOpacity: SettingsSearchEntry
}

export const getModernUiSettingEntries = createLocalizedCatalog((): ModernUiSettingEntries => ({
  modernUi: {
    title: translate('settings.appearance.modernUi.title', 'Modern UI'),
    description: translate(
      'settings.appearance.modernUi.description',
      'Floating cards with rounded corners, refreshed tabs, normal-case headers and frosted overlays.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.cards', 'cards'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.rounded', 'rounded'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.layout', 'layout'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.vscode', 'VS Code', {
        englishOnly: true
      })
    ]
  },
  tabStyle: {
    title: translate('settings.appearance.modernUi.tabStyle.title', 'Tab Style'),
    description: translate(
      'settings.appearance.modernUi.tabStyle.description',
      'Connected tabs join the active tab to its content; pill tabs are separate rounded shapes.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.tabStyle.connected', 'Connected'),
      ...translateSearchKeyword('settings.appearance.modernUi.tabStyle.pill', 'Pill'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.tabs', 'tabs')
    ]
  },
  density: {
    title: translate('settings.appearance.modernUi.density.title', 'Layout Density'),
    description: translate(
      'settings.appearance.modernUi.density.description',
      'Compact removes the gaps and rounded corners so panels meet the window edges.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.density.default', 'Default'),
      ...translateSearchKeyword('settings.appearance.modernUi.density.compact', 'Compact'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.gaps', 'gaps')
    ]
  },
  uppercaseHeaders: {
    title: translate('settings.appearance.modernUi.uppercaseHeaders.title', 'Uppercase Headers'),
    description: translate(
      'settings.appearance.modernUi.uppercaseHeaders.description',
      'Keep section and panel headers in capital letters.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.uppercase', 'uppercase'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.headers', 'headers')
    ]
  },
  frostedGlass: {
    title: translate('settings.appearance.modernUi.frostedGlass.title', 'Frosted Glass'),
    description: translate(
      'settings.appearance.modernUi.frostedGlass.description',
      'Blur what is behind menus, popovers, dialogs, palettes and toasts.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.blur', 'blur'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.translucent', 'translucent')
    ]
  },
  glassOpacity: {
    title: translate('settings.appearance.modernUi.glassOpacity.title', 'Glass Opacity'),
    description: translate(
      'settings.appearance.modernUi.glassOpacity.description',
      'Tint strength of frosted overlays. Lower values show more of the blurred backdrop.'
    ),
    keywords: [
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.opacity', 'opacity'),
      ...translateSearchKeyword('settings.appearance.modernUi.keyword.transparency', 'transparency')
    ]
  }
}))

export function getModernUiSearchEntries(): SettingsSearchEntry[] {
  return Object.values(getModernUiSettingEntries())
}
