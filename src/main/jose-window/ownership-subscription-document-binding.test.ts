import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, getPathMock, subscribeRemoteRuntimeRequestMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  getPathMock: vi.fn(),
  subscribeRemoteRuntimeRequestMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: getPathMock },
  ipcMain: {
    handle: handleMock,
    on: vi.fn()
  }
}))

vi.mock('../../shared/remote-runtime-client', () => ({
  // A re-pair restarts status; left unanswered so it never settles mid-test.
  sendRemoteRuntimeRequest: vi.fn(() => new Promise(() => {})),
  subscribeRemoteRuntimeRequest: subscribeRemoteRuntimeRequestMock
}))

vi.mock('../ipc/runtime-environment-request-connections', async () => {
  const { withRuntimeStatusOwners } = await import('../ipc/runtime-environments-ipc-test-harness')
  return withRuntimeStatusOwners({
    sendRemoteRuntimeConnectionRequest: vi.fn(),
    sendRemoteRuntimeSharedControlRequest: vi.fn(),
    subscribeRemoteRuntimeSharedControlRequest: vi.fn(),
    getRemoteRuntimeSharedControlDiagnostics: vi.fn(() => null),
    reconnectRemoteRuntimeSharedControlConnection: vi.fn(),
    retryRemoteRuntimeSharedControlConnectionsNow: vi.fn(),
    retryRemoteRuntimeSharedControlConnectionNow: vi.fn(),
    ensureRemoteRuntimeSharedControlConnection: vi.fn(),
    pauseRemoteRuntimeSharedControlRetry: vi.fn(),
    closeRemoteRuntimeRequestConnection: vi.fn()
  })
})

import { addEnvironmentFromPairingCode } from '../../shared/runtime-environment-store'
import { resetRuntimeEnvironmentStatusOwners } from '../ipc/runtime-environment-request-connections'
import { registerRuntimeEnvironmentSubscriptionHandlers } from '../ipc/runtime-environment-subscription-handlers'
import { channelHandlerLookup, pairingCode } from '../ipc/runtime-environments-ipc-test-harness'

const handler = channelHandlerLookup(handleMock)

/** A live WebContents: lifecycle events fire, but it is never destroyed. */
class FakeSender extends EventEmitter {
  readonly id = 7
  readonly send = vi.fn()
  isDestroyed(): boolean {
    return false
  }
}

describe('window 2 ownership stream lifetime', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-jose-window-binding-'))
    getPathMock.mockReturnValue(userDataPath)
    handleMock.mockReset()
    subscribeRemoteRuntimeRequestMock.mockReset()
    addEnvironmentFromPairingCode(userDataPath, { name: 'main', pairingCode: pairingCode() })
    registerRuntimeEnvironmentSubscriptionHandlers({
      getUserDataPath: () => userDataPath,
      remoteRuntimeSubscriptions: new Map(),
      pendingSubscriptions: new Map(),
      recordLayoutFrame: vi.fn()
    })
  })

  afterEach(() => {
    resetRuntimeEnvironmentStatusOwners()
    rmSync(userDataPath, { recursive: true, force: true })
  })

  async function subscribe(sender: FakeSender, method: string): Promise<ReturnType<typeof vi.fn>> {
    const close = vi.fn()
    subscribeRemoteRuntimeRequestMock.mockResolvedValue({
      requestId: 'stream-1',
      close,
      sendBinary: () => true
    })
    await handler<{ selector: string; method: string }, unknown>('runtimeEnvironments:subscribe')(
      { sender },
      { selector: 'main', method }
    )
    return close
  }

  it.each(['render-process-gone', 'did-navigate'])(
    'closes the ownership stream on %s while the WebContents lives on',
    async (event) => {
      const sender = new FakeSender()
      const close = await subscribe(sender, 'joseWindow.subscribe')

      sender.emit(event)

      expect(close).toHaveBeenCalledTimes(1)
    }
  )

  it('leaves no lifecycle listener behind once the stream closed', async () => {
    const sender = new FakeSender()
    await subscribe(sender, 'joseWindow.subscribe')
    sender.emit('render-process-gone')

    expect(sender.listenerCount('did-navigate') + sender.listenerCount('destroyed')).toBe(0)
  })

  it('keeps other streams on their destroyed-only lifetime', async () => {
    const sender = new FakeSender()
    const close = await subscribe(sender, 'files.search')

    sender.emit('render-process-gone')

    expect(close).not.toHaveBeenCalled()
  })
})
