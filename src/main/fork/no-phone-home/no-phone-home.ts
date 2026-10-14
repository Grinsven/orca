import type { GlobalSettings } from '../../../shared/global-settings-types'

export const FEEDBACK_OFF_MESSAGE = 'Sending to Orca is turned off in this fork.'
export const RELEASE_BUILDS_OFF_MESSAGE = 'Stock Orca builds are off in this fork.'

// Why: upstream unit suites assert stock network behaviour, so vitest starts unblocked.
let blocked = !(process.env.VITEST === 'true' && '__vitest_worker__' in globalThis)

/** Jose's fork never talks to stock Orca: no usage data, feedback, diagnostics upload, updates or star check. */
export function blocksStockOrcaContact(): boolean {
  return blocked
}

export function _blockStockOrcaContactForTests(value: boolean): void {
  blocked = value
}

type TelemetrySettingsStore = {
  getSettings(): Pick<GlobalSettings, 'telemetry'>
  updateSettings(updates: Pick<GlobalSettings, 'telemetry'>): unknown
}

/** Keeps Settings > Privacy honest: usage sharing reads off because this build never sends it. */
export function keepTelemetryOptedOut(store: TelemetrySettingsStore): void {
  if (!blocked) {
    return
  }
  const telemetry = store.getSettings().telemetry
  if (telemetry && telemetry.optedIn !== false) {
    store.updateSettings({ telemetry: { ...telemetry, optedIn: false } })
  }
}
