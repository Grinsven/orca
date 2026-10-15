import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isJoseUiVariant, type JoseUiVariant } from '../src/shared/fork/jose-ui-variant'

function readVarint(data: Buffer, cursor: { offset: number }): number {
  let value = 0
  for (let shift = 0; shift <= 28; shift += 7) {
    if (cursor.offset >= data.length) {
      throw new Error('Incomplete localStorage record')
    }
    const byte = data[cursor.offset++]
    value += (byte & 127) * 2 ** shift
    if (byte < 128) {
      return value
    }
  }
  throw new Error('Invalid localStorage record length')
}

function readBytes(data: Buffer, cursor: { offset: number }): Buffer {
  const length = readVarint(data, cursor)
  const end = cursor.offset + length
  if (end > data.length) {
    throw new Error('Incomplete localStorage value')
  }
  const result = data.subarray(cursor.offset, end)
  cursor.offset = end
  return result
}

function decode(value: Buffer): string {
  if (value[0] === 1) {
    return value.subarray(1).toString('latin1')
  }
  if (value[0] === 0) {
    return value.subarray(1).toString('utf16le')
  }
  return value.toString('utf8')
}

function logRecords(data: Buffer): Buffer[] {
  const result: Buffer[] = []
  let fragments: Buffer[] = []
  for (let offset = 0; offset < data.length;) {
    const remaining = 32768 - (offset % 32768)
    if (remaining < 7) {
      offset += remaining
      continue
    }
    if (offset + 7 > data.length) {
      throw new Error('Incomplete localStorage WAL header')
    }
    const length = data.readUInt16LE(offset + 4)
    const type = data[offset + 6]
    if (type === 0 && length === 0) {
      offset += remaining
      continue
    }
    if (length + 7 > remaining || offset + 7 + length > data.length) {
      throw new Error('Incomplete localStorage WAL record')
    }
    const payload = data.subarray(offset + 7, offset + 7 + length)
    offset += 7 + length
    if (type === 1) {
      result.push(payload)
    } else if (type === 2) {
      fragments = [payload]
    } else if (type === 3 && fragments.length) {
      fragments.push(payload)
    } else if (type === 4 && fragments.length) {
      result.push(Buffer.concat([...fragments, payload]))
      fragments = []
    } else {
      throw new Error('Unsupported localStorage WAL record')
    }
  }
  if (fragments.length) {
    throw new Error('Incomplete localStorage WAL fragments')
  }
  return result
}

/** WAL-only legacy profiles can be read without opening Chromium's database or taking its lock. */
export function readLegacyVariant(userData: string): JoseUiVariant {
  const directory = join(userData, 'Local Storage', 'leveldb')
  if (!existsSync(directory)) {
    return 'vscode'
  }
  const files = readdirSync(directory)
  if (files.some((name) => /\.(?:ldb|sst)$/.test(name))) {
    throw new Error(
      'Legacy appearance uses compacted storage; pass --variant vscode, gray, or oled'
    )
  }
  let latest = -1n
  let variant: string | undefined
  for (const file of files.filter((name) => /^\d+\.log$/.test(name))) {
    const path = join(directory, file)
    const data = readFileSync(path)
    for (const batch of logRecords(data)) {
      if (batch.length < 12) {
        throw new Error('Incomplete localStorage write batch')
      }
      const sequence = batch.readBigUInt64LE(0)
      const count = batch.readUInt32LE(8)
      const cursor = { offset: 12 }
      for (let index = 0; index < count; index++) {
        const type = batch[cursor.offset++]
        if (type !== 0 && type !== 1) {
          throw new Error('Unsupported localStorage write batch')
        }
        const key = readBytes(batch, cursor)
        const value = type === 1 ? readBytes(batch, cursor) : undefined
        const separator = key.indexOf(0)
        if (separator === -1 || key.subarray(0, separator).toString() !== '_file://') {
          continue
        }
        if (decode(key.subarray(separator + 1)) !== 'jose-ui-variant') {
          continue
        }
        const position = sequence + BigInt(index)
        if (position > latest) {
          latest = position
          variant = value ? decode(value) : undefined
        }
      }
      if (cursor.offset !== batch.length) {
        throw new Error('Invalid localStorage write batch length')
      }
    }
    if (!data.equals(readFileSync(path))) {
      throw new Error('Appearance changed during export; retry')
    }
  }
  if (variant === undefined) {
    return 'vscode'
  }
  if (!isJoseUiVariant(variant)) {
    throw new Error('Legacy appearance variant is unsupported')
  }
  return variant
}
