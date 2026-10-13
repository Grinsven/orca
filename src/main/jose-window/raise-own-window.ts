import { app, type App, type BrowserWindow } from 'electron'
import { focusExistingMainWindow } from '../window/focus-existing-window'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import type { RaiseOwnWindowResult } from '../../shared/jose-window-raise'

type RaiseDeps = {
  app: Pick<App, 'focus' | 'isReady'>
  isBackgroundLaunch: () => boolean
  focusExisting: typeof focusExistingMainWindow
}

const defaultDeps: RaiseDeps = {
  app,
  isBackgroundLaunch,
  focusExisting: focusExistingMainWindow
}

/** Brings this process's window to the front through the second-instance focus path (app
 *  steal, reveal, Windows reinforcement and retry), plus `moveTop` for when macOS refuses. */
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
  deps.focusExisting({
    app: deps.app,
    getWindow: () => window,
    openWindow: () => window,
    // Why: raising never opens a window; the live one is passed in.
    canOpenWindow: () => false
  })
  if (!window.isFocused()) {
    window.moveTop()
  }
  return 'raised'
}
