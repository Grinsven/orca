import { contextBridge } from 'electron'
import { isSecondWindowSlotUserDataPath } from '../shared/second-window-slot-profile'

export type JoseWindowApi = { isSecondWindow: boolean }

/** Why env: a sandboxed preload gets a copy of main's process.env, where startup pins
 *  ORCA_USER_DATA_PATH to the final userData (configureOrcaUserDataPathEnv). */
export function createJoseWindowApi(env: NodeJS.ProcessEnv = process.env): JoseWindowApi {
  return { isSecondWindow: isSecondWindowSlotUserDataPath(env.ORCA_USER_DATA_PATH) }
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
