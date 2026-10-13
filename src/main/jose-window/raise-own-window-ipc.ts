import { app, BrowserWindow, ipcMain, type App } from 'electron'
import { safelyRevealWindow } from '../window/focus-existing-window'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import {
  JOSE_WINDOW_RAISE_CHANNEL,
  type RaiseOwnWindowResult
} from '../../shared/jose-window-raise'

type RaiseDeps = {
  app: Pick<App, 'focus'>
  isBackgroundLaunch: () => boolean
  reveal: (window: BrowserWindow) => void
}

const defaultDeps: RaiseDeps = { app, isBackgroundLaunch, reveal: safelyRevealWindow }

/** Brings this process's window to the front. Another Orca process holds the foreground when
 *  this runs, so the app must take it (`steal`), with `moveTop` for when macOS refuses. */
export function raiseOwnWindow(
  window: BrowserWindow | null,
  deps: RaiseDeps = defaultDeps
): RaiseOwnWindowResult {
  if (!window || window.isDestroyed()) {
    return 'no-window'
  }
  // Why: automated runs must never take the foreground from the developer.
  if (deps.isBackgroundLaunch()) {
    return 'background-launch'
  }
  try {
    deps.app.focus({ steal: true })
  } catch {
    try {
      deps.app.focus()
    } catch {
      // Best-effort; the window reveal below may still work.
    }
  }
  deps.reveal(window)
  if (!window.isFocused()) {
    window.moveTop()
  }
  return 'raised'
}

export function registerRaiseOwnWindowIpc(): void {
  ipcMain.removeHandler(JOSE_WINDOW_RAISE_CHANNEL)
  ipcMain.handle(JOSE_WINDOW_RAISE_CHANNEL, (event): RaiseOwnWindowResult => {
    const result = raiseOwnWindow(BrowserWindow.fromWebContents(event.sender))
    console.info(`[jose-window] raise: ${result}`)
    return result
  })
}
