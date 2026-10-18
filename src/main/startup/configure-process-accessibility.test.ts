import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    setPath: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    isPackaged: false,
    disableHardwareAcceleration: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
      getSwitchValue: vi.fn(() => '')
    }
  }
}))

describe('enableMainProcessGpuFeatures renderer accessibility', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalE2EUserDataDir = process.env.ORCA_E2E_USER_DATA_DIR

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (originalE2EUserDataDir === undefined) {
      delete process.env.ORCA_E2E_USER_DATA_DIR
    } else {
      process.env.ORCA_E2E_USER_DATA_DIR = originalE2EUserDataDir
    }
    vi.restoreAllMocks()
  })

  function setDarwin(): void {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  }

  it('disables renderer accessibility outside E2E so AX pokes cannot stall input', async () => {
    const { app } = await import('electron')
    const { enableMainProcessGpuFeatures } = await import('./configure-process')

    delete process.env.ORCA_E2E_USER_DATA_DIR
    setDarwin()
    vi.mocked(app.commandLine.appendSwitch).mockClear()
    enableMainProcessGpuFeatures()

    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-renderer-accessibility')
  })

  it('keeps renderer accessibility in E2E for CDP snapshots', async () => {
    const { app } = await import('electron')
    const { enableMainProcessGpuFeatures } = await import('./configure-process')

    process.env.ORCA_E2E_USER_DATA_DIR = '/tmp/orca-e2e-accessibility'
    setDarwin()
    vi.mocked(app.commandLine.appendSwitch).mockClear()
    enableMainProcessGpuFeatures()

    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith('disable-renderer-accessibility')
  })
})
