import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./renderer-private-footprint', () => ({ readRendererPrivateFootprint: vi.fn() }))
import { installWindowMemoryRelease } from './window-memory-release'
import { IDLE_MEMORY_RELEASE_DELAY_MS } from './idle-release-timer'
import {
  MEMORY_RELEASE_CLAIM,
  MEMORY_RELEASE_READY,
  MEMORY_RELEASE_REQUEST
} from '../../../renderer/src/fork/memory-release/memory-release-contract'

type Handler = (event: { senderFrame: object }, permit?: number) => unknown
const windows: EventEmitter[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const window of windows.splice(0)) {
    window.emit('closed')
  }
  vi.useRealTimers()
})

function fixture() {
  let focused = true
  let visible = true
  const ipc = Object.assign(new EventEmitter(), {
    handle: (name: string, handler: Handler) => handlers.set(name, handler)
  })
  const handlers = new Map<string, Handler>()
  const mainFrame = {}
  const send = vi.fn()
  const window = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isVisible: () => visible,
    webContents: { ipc, mainFrame, send, getOSProcessId: () => 123 }
  })
  windows.push(window)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake supplies every BrowserWindow member consumed by this adapter.
  installWindowMemoryRelease(window as unknown as BrowserWindow)
  const event = { senderFrame: mainFrame }
  const update = (nextFocused: boolean, nextVisible = true): void => {
    focused = nextFocused
    visible = nextVisible
    window.emit(focused ? 'focus' : visible ? 'blur' : 'hide')
  }
  const permits = () =>
    send.mock.calls
      .filter(([channel]) => channel === MEMORY_RELEASE_REQUEST)
      .map(([, permit]) => permit)
  return { window, ipc, event, handlers, update, permits }
}

describe('native window memory release wiring', () => {
  it('handles hide through native state and issues one hidden-window permission', () => {
    const f = fixture()
    f.update(false, false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect(f.handlers.get(MEMORY_RELEASE_CLAIM)?.(f.event, f.permits()[0])).toEqual({
      allowed: true,
      visible: false
    })
  })

  it('cancels a blur timer when native focus returns', () => {
    const f = fixture()
    f.update(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS - 1)
    f.update(true)
    vi.advanceTimersByTime(1)
    expect(f.permits()).toEqual([])
  })

  it('rejects a permit requested by a child frame without consuming it', () => {
    const f = fixture()
    f.update(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    const permit = f.permits()[0]
    const claim = f.handlers.get(MEMORY_RELEASE_CLAIM)!
    expect([claim({ senderFrame: {} }, permit), claim(f.event, permit)]).toEqual([
      { allowed: false, visible: true },
      { allowed: true, visible: true }
    ])
  })

  it('redelivers a request to a reloaded renderer but rejects it after refocus', () => {
    const f = fixture()
    f.update(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    f.ipc.emit(MEMORY_RELEASE_READY, f.event)
    f.update(true)
    expect({
      deliveries: f.permits().length,
      permission: f.handlers.get(MEMORY_RELEASE_CLAIM)?.(f.event, f.permits()[0])
    }).toEqual({ deliveries: 2, permission: { allowed: false, visible: true } })
  })
})
