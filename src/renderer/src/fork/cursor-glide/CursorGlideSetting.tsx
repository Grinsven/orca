import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SettingsSwitchRow } from '@/components/settings/SettingsFormControls'
import { SearchableSetting } from '@/components/settings/SearchableSetting'
import { isCursorGlideEnabled } from './cursor-glide-settings'

export function CursorGlideSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const enabled = isCursorGlideEnabled(settings)
  return (
    <SearchableSetting
      title="Smooth Cursor"
      description="Slides the cursor when you type and fades a blinking cursor gently."
      keywords={['terminal', 'cursor', 'glide', 'smooth', 'animation', 'blink']}
    >
      <SettingsSwitchRow
        label="Smooth Cursor"
        description="Slides the cursor when you type and fades a blinking cursor gently."
        checked={enabled}
        onChange={() => updateSettings({ terminalCursorGlide: !enabled })}
      />
    </SearchableSetting>
  )
}
