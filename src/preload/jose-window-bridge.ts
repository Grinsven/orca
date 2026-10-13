import { contextBridge, ipcRenderer } from 'electron'
import { isSecondWindowSlotUserDataPath } from '../shared/second-window-slot-profile'
import { JOSE_WINDOW_RAISE_CHANNEL, type RaiseOwnWindowResult } from '../shared/jose-window-raise'

export type JoseWindowApi = {
  isSecondWindow: boolean
  raise: () => Promise<RaiseOwnWindowResult>
}

/** Why env: a sandboxed preload gets a copy of main's process.env, where startup pins
 *  ORCA_USER_DATA_PATH to the final userData (configureOrcaUserDataPathEnv). */
export function createJoseWindowApi(
  env: NodeJS.ProcessEnv = process.env,
  invoke: (channel: string) => Promise<RaiseOwnWindowResult> = (channel) =>
    ipcRenderer.invoke(channel)
): JoseWindowApi {
  return {
    isSecondWindow: isSecondWindowSlotUserDataPath(env.ORCA_USER_DATA_PATH),
    raise: () => invoke(JOSE_WINDOW_RAISE_CHANNEL)
  }
}

/** Fork-only `window.joseWindow`, kept off `window.api` so upstream's PreloadApi stays untouched. */
export function exposeJoseWindowApi(api: JoseWindowApi = createJoseWindowApi()): void {
  if (!process.contextIsolated) {
    Object.assign(window, { joseWindow: api })
    return
  }
  try {
    contextBridge.exposeInMainWorld('joseWindow', api)
  } catch (error) {
    console.error(error)
  }
}
