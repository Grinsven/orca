import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, listAvailableReleaseBuildsMock } = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, ...args: unknown[]) => unknown>(),
  listAvailableReleaseBuildsMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.4.0-fork-test' },
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))
vi.mock('../../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))
vi.mock('../../startup/startup-diagnostics', () => ({ logStartupMilestone: vi.fn() }))
vi.mock('../../updater', () => ({ listAvailableReleaseBuilds: listAvailableReleaseBuildsMock }))

import { makeFakeSettings, makeFakeStore } from '../../telemetry/client-test-harness'
import { registerUpdaterHandlers } from '../../window/main-window-updater'
import { _blockStockOrcaContactForTests, RELEASE_BUILDS_OFF_MESSAGE } from './no-phone-home'

describe('Alt-click release build picker', () => {
  beforeEach(() => {
    handlers.clear()
    listAvailableReleaseBuildsMock.mockReset()
    _blockStockOrcaContactForTests(true)
  })

  afterEach(() => {
    _blockStockOrcaContactForTests(false)
  })

  it.each(['stable', 'daily', 'hourly'])(
    'lists no %s builds and sends no GitHub request',
    async (channel) => {
      registerUpdaterHandlers(makeFakeStore(makeFakeSettings(undefined)))
      const listBuilds = handlers.get('updater:listBuilds')

      await expect(listBuilds?.(null, channel, { force: true })).resolves.toEqual({
        ok: false,
        channel,
        message: RELEASE_BUILDS_OFF_MESSAGE
      })
      expect(listAvailableReleaseBuildsMock).not.toHaveBeenCalled()
    }
  )
})
