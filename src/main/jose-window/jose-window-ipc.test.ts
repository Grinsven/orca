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
import { JOSE_WINDOW_APPLY_INTENT_CHANNEL } from '../../shared/jose-window-intent'
import { registerJoseWindowIpc } from './jose-window-ipc'

const mainFrame = { routingId: 1 }
const sender = { id: 3, mainFrame, send: vi.fn() }

function invoke(channel: string, senderFrame: unknown, ...args: unknown[]): unknown {
  const registered = handleMock.mock.calls.find((call) => call[0] === channel)
  const handler: unknown = registered?.[1]
  if (typeof handler !== 'function') {
    throw new Error(`${channel} handler not registered`)
  }
  return handler({ sender, senderFrame }, ...args)
}

const invokeRaise = (senderFrame: unknown): unknown =>
  invoke(JOSE_WINDOW_RAISE_CHANNEL, senderFrame)

describe('joseWindow:raise handler', () => {
  beforeEach(() => {
    handleMock.mockReset()
    raiseOwnWindowMock.mockClear()
    sender.send.mockClear()
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

describe('joseWindow:applyIntent handler', () => {
  beforeEach(() => {
    handleMock.mockReset()
    sender.send.mockClear()
    isTrustedUIRendererMock.mockReturnValue(true)
    registerJoseWindowIpc()
  })

  it('delivers a redirected file open to this window on its own UI event', () => {
    const request = {
      worktreeId: 'repo::a',
      runtimeEnvironmentId: 'main-env',
      intent: { kind: 'file', filePath: '/repo/a.ts', relativePath: 'a.ts' }
    }

    expect(invoke(JOSE_WINDOW_APPLY_INTENT_CHANNEL, mainFrame, request)).toBe(true)
    expect(sender.send).toHaveBeenCalledWith('ui:openFileFromMobile', {
      worktreeId: 'repo::a',
      filePath: '/repo/a.ts',
      relativePath: 'a.ts',
      runtimeEnvironmentId: 'main-env'
    })
  })

  it('refuses an auxiliary renderer and a malformed request', () => {
    expect(
      invoke(JOSE_WINDOW_APPLY_INTENT_CHANNEL, mainFrame, {
        worktreeId: 'x',
        intent: { kind: 'x' }
      })
    ).toBe(false)
    isTrustedUIRendererMock.mockReturnValue(false)
    expect(() =>
      invoke(JOSE_WINDOW_APPLY_INTENT_CHANNEL, mainFrame, {
        worktreeId: 'repo::a',
        intent: { kind: 'tab', tabId: 't' }
      })
    ).toThrow('main Orca renderer')
    expect(sender.send).not.toHaveBeenCalled()
  })
})
