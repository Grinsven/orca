import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isTrustedUIRenderer } from '../ipc/ui'
import {
  JOSE_WINDOW_RAISE_CHANNEL,
  type RaiseOwnWindowResult
} from '../../shared/jose-window-raise'
import {
  JOSE_WINDOW_APPLY_INTENT_CHANNEL,
  JoseWindowIntentRequest,
  uiEventForIntent
} from '../../shared/jose-window-intent'
import { raiseOwnWindow } from './raise-own-window'

/** Only the main renderer's current document may drive this window: auxiliary renderers share the
 *  preload, and an invoke queued by a replaced document must not act on its successor. */
export function assertTrustedMainFrame(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>
): void {
  if (!isTrustedUIRenderer(event.sender)) {
    throw new Error('joseWindow IPC is only available to the main Orca renderer')
  }
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('joseWindow IPC must originate from the current main frame')
  }
}

export function registerJoseWindowIpc(): void {
  ipcMain.removeHandler(JOSE_WINDOW_RAISE_CHANNEL)
  ipcMain.handle(JOSE_WINDOW_RAISE_CHANNEL, (event): RaiseOwnWindowResult => {
    assertTrustedMainFrame(event)
    const result = raiseOwnWindow(BrowserWindow.fromWebContents(event.sender))
    console.info(`[jose-window] raise: ${result}`)
    return result
  })
  ipcMain.removeHandler(JOSE_WINDOW_APPLY_INTENT_CHANNEL)
  ipcMain.handle(JOSE_WINDOW_APPLY_INTENT_CHANNEL, (event, request: unknown): boolean => {
    assertTrustedMainFrame(event)
    const parsed = JoseWindowIntentRequest.safeParse(request)
    const uiEvent = parsed.success ? uiEventForIntent(parsed.data) : null
    if (!uiEvent) {
      return false
    }
    // Same event main sends for a CLI or mobile request, so the renderer bridge applies it.
    event.sender.send(uiEvent.channel, uiEvent.payload)
    return true
  })
}
