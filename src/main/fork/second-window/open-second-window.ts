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
  type SecondWindowLaunch,
  type SecondWindowLaunchOutcome
} from './second-window-spawn'

const LOCK_POLL_MS = 500
const LOCK_WAIT_MS = 60_000

export type SecondWindowOpenerDeps = {
  hostUserDataPath: () => string
  isSlotRunning: (slotDir: string) => boolean
  /** Pairing, first-run seed and WS port for a slot that is about to start. */
  prepareSlot: (slotDir: string, windowNumber: number) => Promise<void>
  buildLaunch: (slotDir: string) => SecondWindowLaunch
  start: (launch: SecondWindowLaunch, onFailed: () => void) => SecondWindowLaunchOutcome
  setTimer?: (callback: () => void, ms: number) => void
  now?: () => number
}

/**
 * Picking a slot and the child taking its lock are seconds apart, so a slot being launched is
 * reserved here until its lock appears or the launch fails; otherwise two quick New Window
 * clicks both pick it and Electron's single-instance lock drops one of them.
 */
export function createSecondWindowOpener(
  deps: SecondWindowOpenerDeps
): () => Promise<SecondWindowLaunchOutcome> {
  const launching = new Set<number>()
  const setTimer = deps.setTimer ?? ((callback, ms) => void setTimeout(callback, ms))
  const now = deps.now ?? Date.now

  const releaseWhenLocked = (windowNumber: number, slotDir: string, deadline: number): void => {
    if (!launching.has(windowNumber)) {
      return
    }
    if (deps.isSlotRunning(slotDir) || now() >= deadline) {
      launching.delete(windowNumber)
      return
    }
    setTimer(() => releaseWhenLocked(windowNumber, slotDir, deadline), LOCK_POLL_MS)
  }

  return async () => {
    const hostUserDataPath = deps.hostUserDataPath()
    const picked = pickSecondWindowNumber(
      (windowNumber) =>
        launching.has(windowNumber) ||
        deps.isSlotRunning(getSecondWindowSlotDir(hostUserDataPath, windowNumber))
    )
    const slotDir = getSecondWindowSlotDir(hostUserDataPath, picked.windowNumber)
    // Why no pairing for a running slot: the relaunch only hands focus to it through its single-instance lock.
    if (picked.running) {
      return deps.start(deps.buildLaunch(slotDir), () => {})
    }
    const { windowNumber } = picked
    launching.add(windowNumber)
    const release = (): void => {
      launching.delete(windowNumber)
    }
    try {
      await deps.prepareSlot(slotDir, windowNumber)
      const outcome = deps.start(deps.buildLaunch(slotDir), release)
      if (outcome === 'spawned') {
        releaseWhenLocked(windowNumber, slotDir, now() + LOCK_WAIT_MS)
      } else {
        // Nothing was started, so nothing will take the lock.
        release()
      }
      return outcome
    } catch (error) {
      release()
      throw error
    }
  }
}

async function prepareSlot(slotDir: string, windowNumber: number): Promise<void> {
  const hostUserDataPath = app.getPath('userData')
  const record = ensureSecondWindowPairing({
    host: getSecondWindowPairingHost(state.runtimeRpc),
    slotDir,
    windowNumber,
    record: readSecondWindowRecords(hostUserDataPath)[String(windowNumber)] ?? null
  })
  writeSecondWindowRecord(hostUserDataPath, windowNumber, record)
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

/** Window > New Window: a second Orca process on its own slot profile, paired to this runtime. */
export const openSecondWindow = createSecondWindowOpener({
  hostUserDataPath: () => app.getPath('userData'),
  isSlotRunning: (slotDir) => isSecondWindowSlotRunning(slotDir),
  prepareSlot,
  buildLaunch: (slotDir) =>
    buildSecondWindowLaunch({
      slotDir,
      isPackaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      appPath: app.getAppPath()
    }),
  start: (launch, onFailed) => startSecondWindow(launch, process.env, onFailed)
})
