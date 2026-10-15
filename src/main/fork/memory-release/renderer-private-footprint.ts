import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { RendererProcessMemory } from '../../../shared/renderer-process-memory'

export function parseMacPrivateFootprint(output: string): number | null {
  const bytes = /phys_footprint:\s+(\d+) B/.exec(output)?.[1]
  return bytes === undefined ? null : Number(bytes) / 1024
}

export function parseLinuxPrivateFootprint(output: string): number | null {
  const fields = ['Private_Clean', 'Private_Dirty', 'Swap']
  const values = fields.map((field) => new RegExp(`^${field}:\\s+(\\d+) kB`, 'm').exec(output)?.[1])
  return values.some((value) => value === undefined)
    ? null
    : values.reduce((sum, value) => sum + Number(value), 0)
}

/** OS fallback when Chromium refuses its renderer memory dump. Never substitutes RSS. */
export async function readRendererPrivateFootprint(
  pid: number
): Promise<RendererProcessMemory | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }
  try {
    let privateKB: number | null = null
    if (process.platform === 'darwin') {
      const result = await runProcess({
        program: '/usr/bin/footprint',
        args: ['-p', String(pid), '-f', 'bytes', '--noCategories'],
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        maxOutputBytes: 1024 * 1024,
        timeoutMs: 5000
      })
      if (result.code === 0 && !result.timedOut) {
        privateKB = parseMacPrivateFootprint(result.stdout)
      }
    } else if (process.platform === 'linux') {
      privateKB = parseLinuxPrivateFootprint(
        await readFile(join('/proc', String(pid), 'smaps_rollup'), 'utf8')
      )
    } else if (process.platform === 'win32') {
      privateKB =
        app.getAppMetrics().find((metric) => metric.pid === pid)?.memory.privateBytes ?? null
    }
    return privateKB !== null && Number.isFinite(privateKB) && privateKB >= 0 ? { privateKB } : null
  } catch {
    return null
  }
}
