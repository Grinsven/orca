import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import {
  MEMORY_RELEASE_CLAIM,
  MEMORY_RELEASE_ACTIVITY,
  MEMORY_RELEASE_FOOTPRINT,
  MEMORY_RELEASE_READY,
  MEMORY_RELEASE_REQUEST,
  MEMORY_RELEASE_TEST_CONFIGURE,
  type MemoryReleaseTestConfig
} from '../../../renderer/src/fork/memory-release/memory-release-contract'
import { createIdleReleaseTimer } from './idle-release-timer'
import { readRendererPrivateFootprint } from './renderer-private-footprint'

/** Native focus owns eligibility, including independent second-window processes. */
export function installWindowMemoryRelease(window: BrowserWindow): void {
  const contents = window.webContents
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame === contents.mainFrame
  let disabled = false
  const createTimer = (delayMs?: number) =>
    createIdleReleaseTimer({
      delayMs,
      isFocused: () => window.isFocused(),
      requestRelease: (permit) => contents.send(MEMORY_RELEASE_REQUEST, permit)
    })
  let timer = createTimer()
  const update = (): void => timer.update()
  contents.ipc.handle(MEMORY_RELEASE_FOOTPRINT, (event) =>
    trusted(event) ? readRendererPrivateFootprint(contents.getOSProcessId()) : null
  )
  contents.ipc.on(MEMORY_RELEASE_READY, (event) => {
    if (trusted(event)) {
      timer.ready()
    }
  })
  contents.ipc.handle(MEMORY_RELEASE_CLAIM, (event, permit: unknown) => ({
    allowed: trusted(event) && typeof permit === 'number' && timer.claim(permit) && !disabled,
    visible: window.isVisible()
  }))
  if (process.env.ORCA_E2E_HEADLESS === '1' && process.env.ORCA_E2E_USER_DATA_DIR) {
    contents.ipc.handle(MEMORY_RELEASE_TEST_CONFIGURE, (event, config: MemoryReleaseTestConfig) => {
      if (!trusted(event) || !Number.isFinite(config?.delayMs) || config.delayMs <= 0) {
        return
      }
      timer.dispose()
      disabled = config.disabled === true
      timer = createTimer(config.delayMs)
      update()
    })
  }
  window.on('focus', () => {
    update()
    contents.send(MEMORY_RELEASE_ACTIVITY)
  })
  window.on('blur', update)
  window.on('hide', update)
  window.on('show', update)
  window.on('minimize', update)
  window.on('restore', update)
  window.once('closed', () => timer.dispose())
}
