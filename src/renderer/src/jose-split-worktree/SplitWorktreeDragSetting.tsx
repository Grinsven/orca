import { SearchableSetting } from '@/components/settings/SearchableSetting'
import { SettingsSwitchRow } from '@/components/settings/SettingsFormControls'
import { setSplitWorkspaceDragEnabled, useSplitPreference } from './split-worktree-preference'

export function SplitWorktreeDragSetting(): React.JSX.Element | null {
  const { enabled, ready, pending } = useSplitPreference()
  if (!window.joseWindow) {
    return null
  }
  return (
    <SearchableSetting
      title="Drag workspaces to split the view"
      description="Open two workspaces side by side. Turn off to preview the workspace board when dragging."
      keywords={['drag', 'split', 'workspace', 'sidebar', 'board']}
    >
      <SettingsSwitchRow
        label="Drag workspaces to split the view"
        description="Open two workspaces side by side. Turn off to preview the workspace board when dragging."
        checked={enabled}
        disabled={!ready || pending}
        onChange={() => void setSplitWorkspaceDragEnabled(!enabled)}
      />
    </SearchableSetting>
  )
}
