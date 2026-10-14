import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, checkOrcaStarredMock } = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, ...args: unknown[]) => unknown>(),
  checkOrcaStarredMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))
vi.mock('../../github/client', () => ({
  checkOrcaStarred: checkOrcaStarredMock,
  getAuthenticatedViewer: vi.fn(),
  starOrca: vi.fn()
}))

import { registerGitHubAccountHandlers } from '../../ipc/github-account-handlers'
import { makeFakeSettings, makeFakeStore } from '../../telemetry/client-test-harness'
import { _blockStockOrcaContactForTests } from './no-phone-home'

describe('Star on GitHub state on Landing and Settings > General', () => {
  beforeEach(() => {
    handlers.clear()
    checkOrcaStarredMock.mockReset().mockResolvedValue(true)
    _blockStockOrcaContactForTests(true)
  })

  afterEach(() => {
    _blockStockOrcaContactForTests(false)
  })

  it('answers "cannot tell" without running gh against stablyai/orca', async () => {
    registerGitHubAccountHandlers(makeFakeStore(makeFakeSettings(undefined)))
    const checkStarred = handlers.get('gh:checkOrcaStarred')

    expect(await checkStarred?.(null)).toBeNull()
    expect(checkOrcaStarredMock).not.toHaveBeenCalled()
  })
})
