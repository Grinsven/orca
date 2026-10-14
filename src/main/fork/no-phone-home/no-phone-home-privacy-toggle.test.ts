import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'

const { handlers, setOptInMock, consumeConsentMutationTokenMock } = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, ...args: unknown[]) => unknown>(),
  setOptInMock: vi.fn(),
  consumeConsentMutationTokenMock: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))
vi.mock('../../telemetry/client', () => ({
  track: vi.fn(),
  setOptIn: setOptInMock,
  persistBannerAcknowledgeWithoutEmitting: vi.fn()
}))
vi.mock('../../telemetry/burst-cap', () => ({
  consumeConsentMutationToken: consumeConsentMutationTokenMock
}))

import { registerTelemetryHandlers } from '../../ipc/telemetry'
import { makeFakeSettings, makeFakeStore } from '../../telemetry/client-test-harness'
import { _blockStockOrcaContactForTests } from './no-phone-home'

function setOptInHandler(): (_event: unknown, ...args: unknown[]) => unknown {
  const handler = handlers.get('telemetry:setOptIn')
  if (!handler) {
    throw new Error('telemetry:setOptIn was not registered')
  }
  return handler
}

describe('Settings > Privacy usage toggle', () => {
  let settings: GlobalSettings

  beforeEach(() => {
    handlers.clear()
    setOptInMock.mockReset()
    consumeConsentMutationTokenMock.mockClear()
    _blockStockOrcaContactForTests(true)
    settings = makeFakeSettings({
      optedIn: true,
      installId: 'install-1',
      existedBeforeTelemetryRelease: true
    })
    registerTelemetryHandlers(makeFakeStore(settings))
  })

  afterEach(() => {
    _blockStockOrcaContactForTests(false)
  })

  it('reads off from the first window, whatever the profile stored', () => {
    expect(settings.telemetry).toEqual({
      optedIn: false,
      installId: 'install-1',
      existedBeforeTelemetryRelease: true
    })
  })

  it('cannot be turned on, so it never claims to share data', async () => {
    await setOptInHandler()(null, true)

    expect(setOptInMock).not.toHaveBeenCalled()
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })

  it('can still be turned off', async () => {
    await setOptInHandler()(null, false)

    expect(setOptInMock).toHaveBeenCalledWith('settings', false)
  })
})
