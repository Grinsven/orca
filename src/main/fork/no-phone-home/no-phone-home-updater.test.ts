import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from '../../updater-test-module-loader'

const {
  autoUpdaterMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  fetchChangelogMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('../../updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('../../electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('../../ipc/pty', () => moduleFactories.ipcPty())
vi.mock('../../linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('../../updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('../../updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('../../updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('../../update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('../../updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('../../local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('../../local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()

function fakeMainWindow(send = vi.fn()): BrowserWindow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the updater only calls webContents.send on its window.
  return { webContents: { send } } as unknown as BrowserWindow
}

// Why: resetUpdaterMocks resets the module registry, so block the fresh instance updater.ts loads.
async function loadBlockedUpdater(): ReturnType<typeof loadUpdaterModule> {
  const { _blockStockOrcaContactForTests } = await import('./no-phone-home')
  _blockStockOrcaContactForTests(true)
  return loadUpdaterModule()
}

describe('stock Orca updater in a packaged fork build', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
  })

  it('arms no feed, handlers, timers, nudge poll or startup check', async () => {
    const { setupAutoUpdater } = await loadBlockedUpdater()

    setupAutoUpdater(fakeMainWindow(), { getLastUpdateCheckAt: () => null })
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(fetchChangelogMock).not.toHaveBeenCalled()
  })

  it('answers a manual check without asking the stock feed', async () => {
    const send = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadBlockedUpdater()
    setupAutoUpdater(fakeMainWindow(send))

    checkForUpdatesFromMenu()
    checkForUpdatesFromMenu({ targetTag: 'v1.4.0', channel: 'stable' })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('updater:status', {
      state: 'not-available',
      userInitiated: true
    })
  })

  it('refuses paired-server update requests', async () => {
    const { setupAutoUpdater, checkForRemoteServerUpdate } = await loadBlockedUpdater()
    setupAutoUpdater(fakeMainWindow())

    expect(() => checkForRemoteServerUpdate('runtime-1')).toThrow('remote_update_manual_required')
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })
})
