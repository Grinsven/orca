import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isProcessAlive } from '../../daemon/daemon-process-inspection'
import { ORCAD_LOCK_FILE_NAME, readOrcadInstanceLockRecord } from '../../orcad/orcad-instance-lock'
import { orcadProcessStartTimeMatches } from '../../orcad/orcad-process-start-time'
import { writeSecureJsonFile } from '../../../shared/secure-file'

export const FIRST_SECOND_WINDOW_NUMBER = 2
export const LAST_SECOND_WINDOW_NUMBER = 5
const SECOND_WINDOW_RECORDS_FILE = 'fork-second-windows.json'
const SLOT_SUFFIX_PATTERN = /-window-\d+$/

export type SecondWindowSlotRecord = { deviceId: string; environmentId: string }
export type SecondWindowRecords = Record<string, SecondWindowSlotRecord>

export type SlotLivenessProbe = {
  isAlive: (pid: number) => boolean
  startTimeMatches: (pid: number, expected: number | null) => boolean
}

const defaultLivenessProbe: SlotLivenessProbe = {
  isAlive: isProcessAlive,
  startTimeMatches: orcadProcessStartTimeMatches
}

/** `<parent>/orca-window-2` next to `<parent>/orca`; dev gets `orca-dev-window-2`. */
export function getSecondWindowSlotDir(hostUserDataPath: string, windowNumber: number): string {
  return join(dirname(hostUserDataPath), `${basename(hostUserDataPath)}-window-${windowNumber}`)
}

/** A slot instance pairs to its own empty runtime, so it must not open further windows. */
export function isSecondWindowSlotProfile(userDataPath: string): boolean {
  return SLOT_SUFFIX_PATTERN.test(basename(userDataPath))
}

/** Running means the slot's desktop lock names a live pid that started when the lock says. */
export function isSecondWindowSlotRunning(
  slotDir: string,
  probe: SlotLivenessProbe = defaultLivenessProbe
): boolean {
  const record = readOrcadInstanceLockRecord(join(slotDir, ORCAD_LOCK_FILE_NAME))
  if (!record) {
    return false
  }
  return probe.isAlive(record.pid) && probe.startTimeMatches(record.pid, record.startedAtMs)
}

/** Lowest slot not running; when every slot runs, the first one, which a relaunch only focuses. */
export function pickSecondWindowNumber(isRunning: (windowNumber: number) => boolean): {
  windowNumber: number
  running: boolean
} {
  for (let n = FIRST_SECOND_WINDOW_NUMBER; n <= LAST_SECOND_WINDOW_NUMBER; n += 1) {
    if (!isRunning(n)) {
      return { windowNumber: n, running: false }
    }
  }
  return { windowNumber: FIRST_SECOND_WINDOW_NUMBER, running: true }
}

function isSlotRecord(value: unknown): value is SecondWindowSlotRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'deviceId' in value &&
    typeof value.deviceId === 'string' &&
    'environmentId' in value &&
    typeof value.environmentId === 'string'
  )
}

export function readSecondWindowRecords(hostUserDataPath: string): SecondWindowRecords {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(hostUserDataPath, SECOND_WINDOW_RECORDS_FILE), 'utf8')
    )
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, SecondWindowSlotRecord] =>
        isSlotRecord(entry[1])
      )
    )
  } catch {
    return {}
  }
}

export function writeSecondWindowRecord(
  hostUserDataPath: string,
  windowNumber: number,
  record: SecondWindowSlotRecord
): void {
  const records = readSecondWindowRecords(hostUserDataPath)
  writeSecureJsonFile(join(hostUserDataPath, SECOND_WINDOW_RECORDS_FILE), {
    ...records,
    [String(windowNumber)]: record
  })
}
