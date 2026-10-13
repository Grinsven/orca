import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listEnvironments,
  resolveEnvironmentPairingOffer
} from '../../../shared/runtime-environment-store'
import { DeviceRegistry } from '../../runtime/device-registry'
import {
  ensureSecondWindowPairing,
  getSecondWindowPairingHost,
  SECOND_WINDOW_HOST_ENVIRONMENT_NAME
} from './second-window-pairing'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function setup(boundEndpoint = 'ws://0.0.0.0:51234') {
  const registry = new DeviceRegistry(tempDir('orca-second-window-host-'))
  const slotDir = tempDir('orca-second-window-slot-')
  const host = { registry, boundEndpoint, publicKeyB64: 'host-public-key' }
  return { registry, slotDir, host }
}

describe('ensureSecondWindowPairing', () => {
  it('mints a fresh this-computer runtime device and a loopback environment', () => {
    const { registry, slotDir, host } = setup()

    const record = ensureSecondWindowPairing({ host, slotDir, windowNumber: 2, record: null })

    const device = registry.getDevice(record.deviceId)
    expect(device).toMatchObject({
      name: 'Orca window 2',
      scope: 'runtime',
      pairingReach: 'this-computer'
    })
    expect(device?.lastSeenAt).toBeGreaterThan(0)
    const environments = listEnvironments(slotDir)
    expect(environments.map((entry) => [entry.id, entry.name])).toEqual([
      [record.environmentId, SECOND_WINDOW_HOST_ENVIRONMENT_NAME]
    ])
    expect(resolveEnvironmentPairingOffer(slotDir, record.environmentId)).toMatchObject({
      endpoint: 'ws://127.0.0.1:51234',
      deviceToken: device?.token,
      publicKeyB64: 'host-public-key',
      pairedDeviceId: record.deviceId
    })
  })

  it('leaves the pending Settings pairing link alone in both directions', () => {
    const { registry, slotDir, host } = setup()
    const settingsLink = registry.getOrCreatePendingDevice('Runtime', 'runtime', 'network')

    const record = ensureSecondWindowPairing({ host, slotDir, windowNumber: 2, record: null })

    expect(record.deviceId).not.toBe(settingsLink.deviceId)
    expect(registry.getDevice(settingsLink.deviceId)).toEqual(settingsLink)
    expect(registry.getOrCreatePendingDevice('Runtime', 'runtime', 'network').deviceId).toBe(
      settingsLink.deviceId
    )
    registry.rotatePendingDevice('Runtime', 'runtime', 'network')
    expect(registry.getDevice(record.deviceId)).not.toBeNull()
  })

  it('reuses the device and environment on the next launch', () => {
    const { registry, slotDir, host } = setup()
    const first = ensureSecondWindowPairing({ host, slotDir, windowNumber: 2, record: null })
    const revisionBefore = listEnvironments(slotDir)[0]?.pairingRevision

    const second = ensureSecondWindowPairing({ host, slotDir, windowNumber: 2, record: first })

    expect(second).toEqual(first)
    expect(registry.listDevices()).toHaveLength(1)
    expect(listEnvironments(slotDir)[0]?.pairingRevision).toBe(revisionBefore)
  })

  it('re-pairs the same environment after the device was revoked or the port moved', () => {
    const { registry, slotDir, host } = setup()
    const first = ensureSecondWindowPairing({ host, slotDir, windowNumber: 2, record: null })
    registry.removeDevice(first.deviceId)

    const second = ensureSecondWindowPairing({
      host: { ...host, boundEndpoint: 'ws://127.0.0.1:52000' },
      slotDir,
      windowNumber: 2,
      record: first
    })

    expect(second.environmentId).toBe(first.environmentId)
    expect(second.deviceId).not.toBe(first.deviceId)
    const offer = resolveEnvironmentPairingOffer(slotDir, second.environmentId)
    expect(offer.endpoint).toBe('ws://127.0.0.1:52000')
    expect(offer.deviceToken).toBe(registry.getDevice(second.deviceId)?.token)
    expect(listEnvironments(slotDir)).toHaveLength(1)
  })

  it('refuses a runtime that has no pairing transport yet', () => {
    expect(() => getSecondWindowPairingHost(null)).toThrow(/cannot pair/)
    const { registry } = setup()
    expect(() =>
      getSecondWindowPairingHost({
        getDeviceRegistry: () => registry,
        getWebSocketEndpoint: () => null,
        getE2EEPublicKey: () => 'key'
      })
    ).toThrow(/cannot pair/)
  })
})
