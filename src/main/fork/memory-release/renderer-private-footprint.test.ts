import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getAppMetrics: vi.fn() } }))
import { parseLinuxPrivateFootprint, parseMacPrivateFootprint } from './renderer-private-footprint'

describe('renderer private footprint parsing', () => {
  it('reads macOS physical footprint bytes rather than resident memory', () => {
    expect(parseMacPrivateFootprint('resident_size: 900000 B\nphys_footprint: 262144 B\n')).toBe(
      256
    )
  })
  it('rejects macOS output without private footprint', () => {
    expect(parseMacPrivateFootprint('resident_size: 900000 B')).toBeNull()
  })
  it('counts Linux private pages and swapped pages without shared RSS', () => {
    expect(
      parseLinuxPrivateFootprint(
        'Rss: 9000 kB\nPrivate_Clean: 10 kB\nPrivate_Dirty: 200 kB\nSwap: 30 kB\n'
      )
    ).toBe(240)
  })
  it('rejects partial Linux counters rather than reporting a false low footprint', () => {
    expect(parseLinuxPrivateFootprint('Private_Clean: 10 kB\nPrivate_Dirty: 200 kB\n')).toBeNull()
  })
})
