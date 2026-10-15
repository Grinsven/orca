import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCAD_LOCK_FILE_NAME } from '../../orcad/orcad-instance-lock'
import {
  getSecondWindowSlotDir,
  isSecondWindowSlotProfile,
  isSecondWindowSlotRunning,
  pickSecondWindowNumber,
  readSecondWindowRecords,
  writeSecondWindowRecord
} from './second-window-slots'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-second-window-slots-'))
  dirs.push(dir)
  return dir
}

function writeLock(slotDir: string, pid: number, startedAtMs: number | null): void {
  writeFileSync(
    join(slotDir, ORCAD_LOCK_FILE_NAME),
    JSON.stringify({
      pid,
      startedAtMs,
      identity: '501',
      version: '1.4.224',
      acquiredAt: new Date().toISOString(),
      nonce: 'nonce',
      role: 'desktop'
    })
  )
}

describe('second window slots', () => {
  it('places slots next to the host profile', () => {
    const appData = join(tmpdir(), 'Application Support')
    expect(getSecondWindowSlotDir(join(appData, 'orca'), 2)).toBe(join(appData, 'orca-window-2'))
    expect(getSecondWindowSlotDir(join(appData, 'orca-dev'), 3)).toBe(
      join(appData, 'orca-dev-window-3')
    )
  })

  it('recognises a slot profile', () => {
    expect(isSecondWindowSlotProfile(join(tmpdir(), 'orca-window-2'))).toBe(true)
    expect(isSecondWindowSlotProfile(join(tmpdir(), 'orca-dev-window-12'))).toBe(true)
    expect(isSecondWindowSlotProfile(join(tmpdir(), 'orca'))).toBe(false)
    expect(isSecondWindowSlotProfile('')).toBe(false)
  })

  it('reports running only for a live pid whose identity matches the lock', () => {
    const slotDir = tempDir()
    const probe = { isAlive: vi.fn(() => true), identityMatches: vi.fn(() => true) }
    expect(isSecondWindowSlotRunning(slotDir, probe)).toBe(false)

    writeLock(slotDir, 4242, 1000)
    expect(isSecondWindowSlotRunning(slotDir, probe)).toBe(true)
    expect(probe.identityMatches).toHaveBeenCalledWith(
      4242,
      expect.objectContaining({ startedAtMs: 1000 })
    )

    probe.identityMatches.mockReturnValue(false)
    expect(isSecondWindowSlotRunning(slotDir, probe)).toBe(false)

    probe.isAlive.mockReturnValue(false)
    probe.identityMatches.mockReturnValue(true)
    expect(isSecondWindowSlotRunning(slotDir, probe)).toBe(false)

    writeFileSync(join(slotDir, ORCAD_LOCK_FILE_NAME), '{garbled')
    probe.isAlive.mockReturnValue(true)
    expect(isSecondWindowSlotRunning(slotDir, probe)).toBe(false)
  })

  it('sees this process as a running slot through the real probe', () => {
    const slotDir = tempDir()
    writeLock(slotDir, process.pid, null)
    expect(isSecondWindowSlotRunning(slotDir)).toBe(true)
  })

  it('picks the lowest free slot and focuses the first when all run', () => {
    expect(pickSecondWindowNumber(() => false)).toEqual({ windowNumber: 2, running: false })
    expect(pickSecondWindowNumber((n) => n === 2)).toEqual({ windowNumber: 3, running: false })
    expect(pickSecondWindowNumber(() => true)).toEqual({ windowNumber: 2, running: true })
  })

  it('keeps one record per slot and ignores malformed ones', () => {
    const host = tempDir()
    expect(readSecondWindowRecords(host)).toEqual({})
    writeSecondWindowRecord(host, 2, { deviceId: 'd2', environmentId: 'e2' })
    writeSecondWindowRecord(host, 3, { deviceId: 'd3', environmentId: 'e3' })
    writeSecondWindowRecord(host, 2, { deviceId: 'd2b', environmentId: 'e2' })
    expect(readSecondWindowRecords(host)).toEqual({
      '2': { deviceId: 'd2b', environmentId: 'e2' },
      '3': { deviceId: 'd3', environmentId: 'e3' }
    })
    writeFileSync(
      join(host, 'fork-second-windows.json'),
      JSON.stringify({ '2': { deviceId: 1 }, '3': { deviceId: 'd3', environmentId: 'e3' } })
    )
    expect(readSecondWindowRecords(host)).toEqual({
      '3': { deviceId: 'd3', environmentId: 'e3' }
    })
  })
})
