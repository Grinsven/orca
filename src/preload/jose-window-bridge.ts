import { contextBridge, ipcRenderer } from 'electron'
import { isSecondWindowSlotUserDataPath } from '../shared/second-window-slot-profile'
import { JOSE_WINDOW_RAISE_CHANNEL, type RaiseOwnWindowResult } from '../shared/jose-window-raise'
import {
  JOSE_WINDOW_APPLY_INTENT_CHANNEL,
  type JoseWindowIntentRequest
} from '../shared/jose-window-intent'
import { JOSE_WINDOW_OPEN_WINDOW_REQUEST_CHANNEL } from '../shared/jose-window-open-window'

export type JoseWindowApi = {
  isSecondWindow: boolean
  raise: () => Promise<RaiseOwnWindowResult>
  applyIntent: (request: JoseWindowIntentRequest) => Promise<boolean>
  /** Window > New Window in a second window; returns an unsubscribe. */
  onOpenWindowRequest: (callback: () => void) => () => void
}

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>
type Listen = (channel: string, callback: () => void) => () => void

function listen(channel: string, callback: () => void): () => void {
  const listener = (): void => callback()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const RAISE_RESULTS: readonly RaiseOwnWindowResult[] = ['raised', 'background-launch', 'no-window']

function toRaiseResult(value: unknown): RaiseOwnWindowResult {
  return RAISE_RESULTS.find((result) => result === value) ?? 'no-window'
}

/** Why env: a sandboxed preload gets a copy of main's process.env, where startup pins
 *  ORCA_USER_DATA_PATH to the final userData (configureOrcaUserDataPathEnv). */
export function createJoseWindowApi(
  env: NodeJS.ProcessEnv = process.env,
  invoke: Invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: Listen = listen
): JoseWindowApi {
  return {
    isSecondWindow: isSecondWindowSlotUserDataPath(env.ORCA_USER_DATA_PATH),
    raise: () => invoke(JOSE_WINDOW_RAISE_CHANNEL).then(toRaiseResult),
    applyIntent: (request) =>
      invoke(JOSE_WINDOW_APPLY_INTENT_CHANNEL, request).then((applied) => applied === true),
    onOpenWindowRequest: (callback) => on(JOSE_WINDOW_OPEN_WINDOW_REQUEST_CHANNEL, callback)
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
