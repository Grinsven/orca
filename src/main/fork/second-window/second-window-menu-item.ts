import { translateMain } from '../../i18n/main-i18n'
import { argvRequestsServeMode } from '../../startup/serve-mode-argv'
import { mainProcessState } from '../../startup/main-process-state'
import { JOSE_WINDOW_OPEN_WINDOW_REQUEST_CHANNEL } from '../../../shared/jose-window-open-window'
import { isSecondWindowSlotProfile } from './second-window-slots'

export const NEW_ORCA_WINDOW_MENU_ITEM_ID = 'fork-new-orca-window'

export function openSecondWindowFromMenu(): void {
  // Why lazy: the opener pulls in runtime and persistence modules the menu must not load at startup.
  void import('./open-second-window')
    .then(({ openSecondWindow }) => openSecondWindow())
    .catch((error: unknown) => console.error('[second-window] New Window failed:', error))
}

/** In a slot window the renderer asks the paired host, over the client its ownership session uses. */
export function requestNewWindowFromHost(): void {
  const contents = mainProcessState.mainWindow?.webContents
  if (!contents || contents.isDestroyed()) {
    console.warn('[second-window] New Window: no window to ask the host from')
    return
  }
  contents.send(JOSE_WINDOW_OPEN_WINDOW_REQUEST_CHANNEL)
}

/** Window > New Window, from every window; absent in headless serve. A slot window forwards it. */
export function createSecondWindowMenuItems(
  argv: readonly string[] = process.argv,
  userDataPath: string = process.env.ORCA_USER_DATA_PATH ?? ''
): Electron.MenuItemConstructorOptions[] {
  if (argvRequestsServeMode(argv)) {
    return []
  }
  return [
    {
      id: NEW_ORCA_WINDOW_MENU_ITEM_ID,
      label: translateMain('menu.newOrcaWindow', 'New Window'),
      click: isSecondWindowSlotProfile(userDataPath)
        ? requestNewWindowFromHost
        : openSecondWindowFromMenu
    },
    { type: 'separator' }
  ]
}
