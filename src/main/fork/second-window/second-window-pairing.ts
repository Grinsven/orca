import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../../shared/pairing'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  resolveEnvironmentPairingOffer,
  updateEnvironmentFromPairingCode
} from '../../../shared/runtime-environment-store'
import type { DeviceEntry, DeviceRegistry } from '../../runtime/device-registry'
import { resolveAdvertisedPairingEndpoint } from '../../runtime/pairing-endpoint'
import type { SecondWindowSlotRecord } from './second-window-slots'

/** Name window N gives the main Orca in its host list. */
export const SECOND_WINDOW_HOST_ENVIRONMENT_NAME = 'Main Orca window'

export type SecondWindowPairingHost = {
  registry: Pick<DeviceRegistry, 'addDevice' | 'getDevice' | 'updateLastSeen'>
  boundEndpoint: string
  publicKeyB64: string
}

type RuntimeRpcPairingSource = {
  getDeviceRegistry: () => SecondWindowPairingHost['registry'] | null
  getWebSocketEndpoint: () => string | null
  getE2EEPublicKey: () => string | null
}

export function getSecondWindowPairingHost(
  rpc: RuntimeRpcPairingSource | null
): SecondWindowPairingHost {
  const registry = rpc?.getDeviceRegistry() ?? null
  const boundEndpoint = rpc?.getWebSocketEndpoint() ?? null
  const publicKeyB64 = rpc?.getE2EEPublicKey() ?? null
  if (!registry || !boundEndpoint || !publicKeyB64) {
    throw new Error('This Orca runtime cannot pair a new window yet.')
  }
  return { registry, boundEndpoint, publicKeyB64 }
}

function ensureWindowDevice(
  host: SecondWindowPairingHost,
  windowNumber: number,
  record: SecondWindowSlotRecord | null
): DeviceEntry {
  const existing = record ? host.registry.getDevice(record.deviceId) : null
  if (existing?.scope === 'runtime') {
    return existing
  }
  // Why addDevice, not createPairingOffer: that reuses or rotates the pending link Settings hands out.
  const device = host.registry.addDevice(`Orca window ${windowNumber}`, 'runtime', 'this-computer')
  // Why: a never-seen runtime device is what Settings' next pairing link would reuse or rotate away.
  host.registry.updateLastSeen(device.deviceId)
  return device
}

/** Mints or reuses window N's loopback device and points the slot's environment store at it. */
export function ensureSecondWindowPairing(args: {
  host: SecondWindowPairingHost
  slotDir: string
  windowNumber: number
  record: SecondWindowSlotRecord | null
}): SecondWindowSlotRecord {
  const { host, slotDir, windowNumber, record } = args
  const advertised = resolveAdvertisedPairingEndpoint(host.boundEndpoint, '127.0.0.1')
  if (!advertised.ok) {
    throw new Error(advertised.guidance)
  }
  const device = ensureWindowDevice(host, windowNumber, record)
  const pairingCode = encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint: advertised.endpoint,
    deviceToken: device.token,
    publicKeyB64: host.publicKeyB64,
    pairedDeviceId: device.deviceId,
    scope: 'runtime'
  })
  const environments = listEnvironments(slotDir)
  const existing =
    environments.find((entry) => entry.id === record?.environmentId) ??
    environments.find((entry) => entry.name === SECOND_WINDOW_HOST_ENVIRONMENT_NAME)
  if (!existing) {
    const created = addEnvironmentFromPairingCode(slotDir, {
      name: SECOND_WINDOW_HOST_ENVIRONMENT_NAME,
      pairingCode
    })
    return { deviceId: device.deviceId, environmentId: created.id }
  }
  const current = resolveEnvironmentPairingOffer(slotDir, existing.id)
  if (
    current.endpoint !== advertised.endpoint ||
    current.deviceToken !== device.token ||
    current.publicKeyB64 !== host.publicKeyB64
  ) {
    updateEnvironmentFromPairingCode(slotDir, existing.id, { pairingCode })
  }
  return { deviceId: device.deviceId, environmentId: existing.id }
}
