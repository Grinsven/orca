import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(), isPackaged: false, getAppPath: vi.fn() } }))
vi.mock('../../startup/main-process-state', () => ({ mainProcessState: {} }))

import { createSecondWindowOpener, type SecondWindowOpenerDeps } from './open-second-window'
import type { SecondWindowLaunch, SecondWindowLaunchOutcome } from './second-window-spawn'

const hostProfile = join(tmpdir(), 'orca')

function harness() {
  const running = new Set<string>()
  const timers: (() => void)[] = []
  let failLaunch: (() => void) | null = null
  const deps = {
    hostUserDataPath: () => hostProfile,
    isSlotRunning: (slotDir: string) => running.has(slotDir),
    // Why a real await: the race the reservation closes spans this step.
    prepareSlot: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }),
    buildLaunch: (slotDir: string): SecondWindowLaunch => ({
      mode: 'dev',
      program: 'electron',
      args: [],
      envOverrides: {},
      slotDir
    }),
    start: vi.fn((_launch: SecondWindowLaunch, onFailed: () => void): SecondWindowLaunchOutcome => {
      failLaunch = onFailed
      return 'spawned'
    }),
    setTimer: (callback: () => void) => {
      timers.push(callback)
    }
  } satisfies SecondWindowOpenerDeps
  const launchedSlots = (): string[] => deps.start.mock.calls.map(([launch]) => launch.slotDir)
  return { deps, running, timers, launchedSlots, failLaunch: () => failLaunch?.() }
}

const slot = (n: number): string => join(tmpdir(), `orca-window-${n}`)

describe('createSecondWindowOpener', () => {
  it('gives two concurrent New Window requests two different slots', async () => {
    const h = harness()
    const open = createSecondWindowOpener(h.deps)

    await Promise.all([open(), open()])

    expect(h.launchedSlots()).toEqual([slot(2), slot(3)])
  })

  it('keeps the slot reserved until its lock appears, then frees the reservation', async () => {
    const h = harness()
    const open = createSecondWindowOpener(h.deps)
    await open()
    h.timers.shift()?.()
    await open()

    h.running.add(slot(2))
    h.timers.splice(0).forEach((tick) => tick())
    h.running.clear()
    await open()

    expect(h.launchedSlots()).toEqual([slot(2), slot(3), slot(2)])
  })

  it('joins a slot still being prepared when every slot is taken, instead of starting it early', async () => {
    const h = harness()
    let finishPreparing: () => void = () => {}
    const prepared = new Promise<void>((resolve) => {
      finishPreparing = resolve
    })
    h.deps.prepareSlot.mockImplementation(() => prepared)
    const open = createSecondWindowOpener(h.deps)
    const requests = [open(), open(), open(), open()]

    const extra = open()
    const startedBeforePrepared = h.launchedSlots()
    finishPreparing()
    await Promise.all([...requests, extra])

    expect({ startedBeforePrepared, started: h.launchedSlots(), extra: await extra }).toEqual({
      startedBeforePrepared: [],
      started: [slot(2), slot(3), slot(4), slot(5)],
      extra: 'spawned'
    })
  })

  it('frees the slot when the launch fails', async () => {
    const h = harness()
    const open = createSecondWindowOpener(h.deps)
    await open()
    h.failLaunch()
    await open()

    expect(h.launchedSlots()).toEqual([slot(2), slot(2)])
  })
})
