// Jose fork-local: Modern UI switch plus its details, shown under Appearance > Interface.
import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  MODERN_UI_GLASS_OPACITY_DEFAULT,
  MODERN_UI_GLASS_OPACITY_MAX,
  MODERN_UI_GLASS_OPACITY_MIN
} from '../../../../shared/modern-ui-settings'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSwitchRow
} from './SettingsFormControls'
import { getModernUiSettingEntries } from './appearance-modern-ui-search'

type AppearanceModernUiGroupProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisible?: boolean
}

export function AppearanceModernUiGroup({
  settings,
  updateSettings,
  forceVisible = false
}: AppearanceModernUiGroupProps): React.JSX.Element {
  const entries = getModernUiSettingEntries()
  const { modernUi, tabStyle, density, uppercaseHeaders, frostedGlass, glassOpacity } = entries

  return (
    <div data-testid="modern-ui-settings">
      <SearchableSetting
        title={modernUi.title}
        description={modernUi.description}
        // Why: the details hide while off, so the switch must also answer searches for them.
        keywords={Object.values(entries).flatMap((entry) => [
          entry.title,
          ...(entry.keywords ?? [])
        ])}
        forceVisible={forceVisible}
      >
        <SettingsSwitchRow
          label={modernUi.title}
          description={modernUi.description}
          checked={settings.modernUi}
          onChange={() => updateSettings({ modernUi: !settings.modernUi })}
        />
      </SearchableSetting>

      {settings.modernUi ? (
        <div className="mb-2 ml-1 divide-y divide-border/40 border-l border-border/60 pl-4">
          <SearchableSetting {...tabStyle} forceVisible={forceVisible}>
            <SettingsRow
              label={tabStyle.title}
              description={tabStyle.description}
              control={
                <SettingsSegmentedControl
                  ariaLabel={tabStyle.title}
                  value={settings.modernUiTabStyle}
                  onChange={(modernUiTabStyle) => updateSettings({ modernUiTabStyle })}
                  options={[
                    {
                      value: 'connected',
                      label: translate(
                        'settings.appearance.modernUi.tabStyle.connected',
                        'Connected'
                      )
                    },
                    {
                      value: 'pill',
                      label: translate('settings.appearance.modernUi.tabStyle.pill', 'Pill')
                    }
                  ]}
                />
              }
            />
          </SearchableSetting>

          <SearchableSetting {...density} forceVisible={forceVisible}>
            <SettingsRow
              label={density.title}
              description={density.description}
              control={
                <SettingsSegmentedControl
                  ariaLabel={density.title}
                  value={settings.modernUiDensity}
                  onChange={(modernUiDensity) => updateSettings({ modernUiDensity })}
                  options={[
                    {
                      value: 'default',
                      label: translate('settings.appearance.modernUi.density.default', 'Default')
                    },
                    {
                      value: 'compact',
                      label: translate('settings.appearance.modernUi.density.compact', 'Compact')
                    }
                  ]}
                />
              }
            />
          </SearchableSetting>

          <SearchableSetting {...uppercaseHeaders} forceVisible={forceVisible}>
            <SettingsSwitchRow
              label={uppercaseHeaders.title}
              description={uppercaseHeaders.description}
              checked={settings.modernUiUppercaseHeaders}
              onChange={() =>
                updateSettings({ modernUiUppercaseHeaders: !settings.modernUiUppercaseHeaders })
              }
            />
          </SearchableSetting>

          <SearchableSetting {...frostedGlass} forceVisible={forceVisible}>
            <SettingsSwitchRow
              label={frostedGlass.title}
              description={frostedGlass.description}
              checked={settings.modernUiFrostedGlass}
              onChange={() =>
                updateSettings({ modernUiFrostedGlass: !settings.modernUiFrostedGlass })
              }
            />
          </SearchableSetting>

          {settings.modernUiFrostedGlass ? (
            <SearchableSetting {...glassOpacity} forceVisible={forceVisible}>
              <NumberField
                label={glassOpacity.title}
                description={glassOpacity.description ?? ''}
                value={settings.modernUiFrostedGlassOpacity}
                defaultValue={MODERN_UI_GLASS_OPACITY_DEFAULT}
                min={MODERN_UI_GLASS_OPACITY_MIN}
                max={MODERN_UI_GLASS_OPACITY_MAX}
                integer
                suffix={translate(
                  'settings.appearance.modernUi.glassOpacity.range',
                  '{{min}} to {{max}}%',
                  {
                    min: MODERN_UI_GLASS_OPACITY_MIN,
                    max: MODERN_UI_GLASS_OPACITY_MAX
                  }
                )}
                onChange={(modernUiFrostedGlassOpacity) =>
                  updateSettings({ modernUiFrostedGlassOpacity })
                }
              />
            </SearchableSetting>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
