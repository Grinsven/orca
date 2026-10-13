import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeRpcMock, toastErrorMock } = vi.hoisted(() => ({
  callRuntimeRpcMock: vi.fn(),
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcClient>()),
  callRuntimeRpc: callRuntimeRpcMock
}))

import type * as RuntimeRpcClient from '@/runtime/runtime-rpc-client'
import { openWindowOnHost, resetOpenWindowLogForTests } from './open-window-on-host'

const HUB = { kind: 'environment', environmentId: 'hub-env' } as const

beforeEach(() => resetOpenWindowLogForTests())
afterEach(() => {
  callRuntimeRpcMock.mockReset()
  toastErrorMock.mockReset()
  vi.restoreAllMocks()
})

describe('openWindowOnHost', () => {
  it('asks the paired host to open the window', async () => {
    callRuntimeRpcMock.mockResolvedValue({ outcome: 'spawned' })

    expect({
      result: await openWindowOnHost(HUB),
      call: callRuntimeRpcMock.mock.calls[0]?.slice(0, 3)
    }).toEqual({
      result: { outcome: 'spawned' },
      call: [HUB, 'joseWindow.openWindow', {}]
    })
  })

  it('tells the user the host needs an update when it has no such method, logging once', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    callRuntimeRpcMock.mockRejectedValue(
      Object.assign(new Error('Unknown method'), { code: 'method_not_found' })
    )

    const results = [await openWindowOnHost(HUB), await openWindowOnHost(HUB)]

    expect({
      results,
      toasts: toastErrorMock.mock.calls,
      logged: info.mock.calls.length
    }).toEqual({
      results: [null, null],
      toasts: [
        ['Update the main Orca window to open a new window from here.'],
        ['Update the main Orca window to open a new window from here.']
      ],
      logged: 1
    })
  })

  it('reports any other failure as a failed open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    callRuntimeRpcMock.mockRejectedValue(new Error('socket closed'))

    expect({ result: await openWindowOnHost(HUB), toasts: toastErrorMock.mock.calls }).toEqual({
      result: null,
      toasts: [['Could not open a new window.']]
    })
  })
})
