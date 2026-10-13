import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, isTrustedUIRendererMock, raiseOwnWindowMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  isTrustedUIRendererMock: vi.fn(),
  raiseOwnWindowMock: vi.fn(() => 'raised')
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))
vi.mock('./raise-own-window', () => ({ raiseOwnWindow: raiseOwnWindowMock }))

import { JOSE_WINDOW_RAISE_CHANNEL } from '../../shared/jose-window-raise'
import { registerJoseWindowIpc } from './jose-window-ipc'

const mainFrame = { routingId: 1 }
const sender = { id: 3, mainFrame }

function invokeRaise(senderFrame: unknown): unknown {
  const registered = handleMock.mock.calls.find((call) => call[0] === JOSE_WINDOW_RAISE_CHANNEL)
  const handler: unknown = registered?.[1]
  if (typeof handler !== 'function') {
    throw new Error('raise handler not registered')
  }
  return handler({ sender, senderFrame })
}

describe('joseWindow:raise handler', () => {
  beforeEach(() => {
    handleMock.mockReset()
    raiseOwnWindowMock.mockClear()
    isTrustedUIRendererMock.mockReturnValue(true)
    registerJoseWindowIpc()
  })

  it('refuses an auxiliary renderer that shares the preload', () => {
    isTrustedUIRendererMock.mockReturnValue(false)
    expect(() => invokeRaise(mainFrame)).toThrow('main Orca renderer')
    expect(raiseOwnWindowMock).not.toHaveBeenCalled()
  })

  it('refuses an invoke queued by a replaced document', () => {
    expect(() => invokeRaise({ routingId: 2 })).toThrow('current main frame')
    expect(raiseOwnWindowMock).not.toHaveBeenCalled()
  })

  it('raises for the main renderer current document', () => {
    expect(invokeRaise(mainFrame)).toBe('raised')
  })
})
