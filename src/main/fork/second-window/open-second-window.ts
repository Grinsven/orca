import { app } from 'electron'
import { mainProcessState as state } from '../../startup/main-process-state'
import { ensureSecondWindowPairing, getSecondWindowPairingHost } from './second-window-pairing'
import {
  buildSecondWindowSeed,
  ensureSecondWindowWsPort,
  isSecondWindowSlotSeeded,
  writeSecondWindowSeed
} from './second-window-profile-seed'
import {
  getSecondWindowSlotDir,
  isSecondWindowSlotRunning,
  pickSecondWindowNumber,
  readSecondWindowRecords,
  writeSecondWindowRecord
} from './second-window-slots'
import {
  buildSecondWindowLaunch,
  startSecondWindow,
  type SecondWindowLaunchOutcome
} from './second-window-spawn'

/** Window > New Window: a second Orca process on its own slot profile, paired to this runtime. */
export async function openSecondWindow(): Promise<SecondWindowLaunchOutcome> {
  const hostUserDataPath = app.getPath('userData')
  const picked = pickSecondWindowNumber((windowNumber) =>
    isSecondWindowSlotRunning(getSecondWindowSlotDir(hostUserDataPath, windowNumber))
  )
  const slotDir = getSecondWindowSlotDir(hostUserDataPath, picked.windowNumber)
  // Why no pairing for a running slot: the relaunch only hands focus to it through its single-instance lock.
  if (!picked.running) {
    const record = ensureSecondWindowPairing({
      host: getSecondWindowPairingHost(state.runtimeRpc),
      slotDir,
      windowNumber: picked.windowNumber,
      record: readSecondWindowRecords(hostUserDataPath)[String(picked.windowNumber)] ?? null
    })
    writeSecondWindowRecord(hostUserDataPath, picked.windowNumber, record)
    if (!isSecondWindowSlotSeeded(slotDir)) {
      const store = state.store
      if (!store) {
        throw new Error('Settings are not loaded yet.')
      }
      writeSecondWindowSeed(
        slotDir,
        buildSecondWindowSeed(
          {
            settings: store.getSettings(),
            ui: store.getUI(),
            onboarding: store.getOnboarding()
          },
          record.environmentId
        )
      )
    }
    await ensureSecondWindowWsPort(slotDir)
  }
  return startSecondWindow(
    buildSecondWindowLaunch({
      slotDir,
      isPackaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      appPath: app.getAppPath()
    })
  )
}
