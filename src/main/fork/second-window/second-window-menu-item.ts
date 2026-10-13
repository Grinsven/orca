import { translateMain } from '../../i18n/main-i18n'
import { argvRequestsServeMode } from '../../startup/serve-mode-argv'
import { isSecondWindowSlotProfile } from './second-window-slots'

export const NEW_ORCA_WINDOW_MENU_ITEM_ID = 'fork-new-orca-window'

function openSecondWindowFromMenu(): void {
  // Why lazy: the opener pulls in runtime and persistence modules the menu must not load at startup.
  void import('./open-second-window')
    .then(({ openSecondWindow }) => openSecondWindow())
    .catch((error: unknown) => console.error('[second-window] New Window failed:', error))
}

/** Window > New Window; absent in headless serve and inside a window that is itself a slot. */
export function createSecondWindowMenuItems(
  argv: readonly string[] = process.argv,
  userDataPath: string = process.env.ORCA_USER_DATA_PATH ?? ''
): Electron.MenuItemConstructorOptions[] {
  if (argvRequestsServeMode(argv) || isSecondWindowSlotProfile(userDataPath)) {
    return []
  }
  return [
    {
      id: NEW_ORCA_WINDOW_MENU_ITEM_ID,
      label: translateMain('menu.newOrcaWindow', 'New Window'),
      click: openSecondWindowFromMenu
    },
    { type: 'separator' }
  ]
}
