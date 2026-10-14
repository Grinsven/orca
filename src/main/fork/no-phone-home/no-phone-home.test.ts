import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  _blockStockOrcaContactForTests,
  blocksStockOrcaContact,
  keepTelemetryOptedOut
} from './no-phone-home'

const INSTALL_ID = '00000000-0000-4000-8000-000000000000'

function fakeStore(telemetry: GlobalSettings['telemetry']) {
  let settings: Pick<GlobalSettings, 'telemetry'> = { telemetry }
  return {
    getSettings: () => settings,
    updateSettings: vi.fn((updates: Pick<GlobalSettings, 'telemetry'>) => {
      settings = { ...settings, ...updates }
    })
  }
}

describe('no-phone-home', () => {
  afterEach(() => {
    _blockStockOrcaContactForTests(false)
  })

  it('starts unblocked under vitest so upstream suites keep stock behaviour', () => {
    expect(blocksStockOrcaContact()).toBe(false)
    _blockStockOrcaContactForTests(true)
    expect(blocksStockOrcaContact()).toBe(true)
  })

  it.each([true, null])('turns usage sharing off when it was %s', (optedIn) => {
    _blockStockOrcaContactForTests(true)
    const store = fakeStore({ optedIn, installId: INSTALL_ID, existedBeforeTelemetryRelease: true })

    keepTelemetryOptedOut(store)

    expect(store.updateSettings).toHaveBeenCalledWith({
      telemetry: { optedIn: false, installId: INSTALL_ID, existedBeforeTelemetryRelease: true }
    })
  })

  it('writes nothing when sharing is already off or the block is lifted', () => {
    _blockStockOrcaContactForTests(true)
    const off = fakeStore({
      optedIn: false,
      installId: INSTALL_ID,
      existedBeforeTelemetryRelease: false
    })
    keepTelemetryOptedOut(off)
    expect(off.updateSettings).not.toHaveBeenCalled()

    _blockStockOrcaContactForTests(false)
    const on = fakeStore({
      optedIn: true,
      installId: INSTALL_ID,
      existedBeforeTelemetryRelease: false
    })
    keepTelemetryOptedOut(on)
    expect(on.updateSettings).not.toHaveBeenCalled()
  })
})
