import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnProcessMock, child } = vi.hoisted(() => {
  const child = { once: vi.fn(), unref: vi.fn() }
  return { spawnProcessMock: vi.fn(() => child), child }
})

vi.mock('../../../shared/child-process/run-process', () => ({ spawnProcess: spawnProcessMock }))

import { buildSecondWindowLaunch, startSecondWindow } from './second-window-spawn'

const slotDir = join(tmpdir(), 'orca-window-2')
const dirs: string[] = []

beforeEach(() => {
  spawnProcessMock.mockClear()
  child.once.mockClear()
  child.unref.mockClear()
})
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('buildSecondWindowLaunch', () => {
  it('opens a new instance of the packaged macOS bundle on the slot profile', () => {
    expect(
      buildSecondWindowLaunch({
        slotDir,
        isPackaged: true,
        platform: 'darwin',
        execPath: '/Applications/Orca Patched.app/Contents/MacOS/Orca Patched',
        appPath: '/Applications/Orca Patched.app/Contents/Resources/app.asar'
      })
    ).toEqual({
      mode: 'packaged-mac',
      program: 'open',
      args: ['-n', '/Applications/Orca Patched.app', '--args', `--user-data-dir=${slotDir}`],
      envOverrides: { ORCA_USER_DATA_PATH: slotDir },
      slotDir
    })
  })

  it('runs the packaged executable directly off macOS', () => {
    expect(
      buildSecondWindowLaunch({
        slotDir,
        isPackaged: true,
        platform: 'linux',
        execPath: '/opt/Orca/orca',
        appPath: '/opt/Orca/resources/app.asar'
      })
    ).toMatchObject({
      mode: 'packaged',
      program: '/opt/Orca/orca',
      args: [`--user-data-dir=${slotDir}`]
    })
  })

  it('runs the dev Electron with the app root and ORCA_DEV_USER_DATA_PATH', () => {
    expect(
      buildSecondWindowLaunch({
        slotDir,
        isPackaged: false,
        platform: 'darwin',
        execPath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
        appPath: '/repo'
      })
    ).toEqual({
      mode: 'dev',
      program: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      args: ['/repo', `--user-data-dir=${slotDir}`],
      envOverrides: { ORCA_USER_DATA_PATH: slotDir, ORCA_DEV_USER_DATA_PATH: slotDir },
      slotDir
    })
  })
})

describe('startSecondWindow', () => {
  const launch = buildSecondWindowLaunch({
    slotDir,
    isPackaged: false,
    platform: 'darwin',
    execPath: '/electron',
    appPath: '/repo'
  })

  it('writes a launch record instead of spawning when asked to', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-second-window-spawn-'))
    dirs.push(dir)
    const recordPath = join(dir, 'launch.json')
    expect(
      startSecondWindow(launch, {
        ORCA_FORK_WINDOW_LAUNCH_RECORD: recordPath,
        ORCA_E2E_USER_DATA_DIR: dir
      })
    ).toBe('recorded')
    expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual(launch)
    expect(spawnProcessMock).not.toHaveBeenCalled()
  })

  it('never spawns from an E2E instance without a launch record', () => {
    expect(startSecondWindow(launch, { ORCA_E2E_USER_DATA_DIR: '/tmp/e2e' })).toBe('skipped-e2e')
    expect(spawnProcessMock).not.toHaveBeenCalled()
  })

  it('spawns detached with the slot overrides and without ELECTRON_RUN_AS_NODE', () => {
    expect(
      startSecondWindow(launch, {
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_USER_DATA_PATH: '/host'
      })
    ).toBe('spawned')
    expect(spawnProcessMock).toHaveBeenCalledWith({
      program: '/electron',
      args: ['/repo', `--user-data-dir=${slotDir}`],
      env: { PATH: '/usr/bin', ORCA_USER_DATA_PATH: slotDir, ORCA_DEV_USER_DATA_PATH: slotDir },
      detached: true,
      stdio: 'ignore'
    })
    expect(child.once).toHaveBeenCalledWith('error', expect.any(Function))
    expect(child.unref).toHaveBeenCalled()
  })
})
