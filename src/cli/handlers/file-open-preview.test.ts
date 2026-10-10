import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const MAP = 'docs/project-map.html'

function openResult(extra: Record<string, unknown> = {}): ReturnType<typeof okFixture> {
  return okFixture('req_open', {
    worktree: 'wt-1',
    relativePath: MAP,
    kind: 'text',
    opened: true,
    ...extra
  })
}

describe('orca file open --preview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('asks the host for a preview and reports it', async () => {
    queueFixtures(callMock, openResult({ preview: true }))

    await main(['file', 'open', MAP, '--preview', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('files.open', {
      worktree: 'id:wt-1',
      relativePath: MAP,
      navigation: 'caller',
      preview: true
    })
    expect(vi.mocked(console.log).mock.calls[0][0]).toBe(`Opened preview of ${MAP}.`)
    expect(process.exitCode).toBeUndefined()
  })

  it('carries --focus alongside --preview', async () => {
    queueFixtures(callMock, openResult({ preview: true }))

    await main(['file', 'open', MAP, '--preview', '--focus', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith('files.open', {
      worktree: 'id:wt-1',
      relativePath: MAP,
      navigation: 'all',
      preview: true
    })
  })

  it('sends exactly the plain params without --preview, even for an HTML file', async () => {
    queueFixtures(callMock, openResult())

    await main(['file', 'open', MAP, '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock.mock.calls[0]).toEqual([
      'files.open',
      { worktree: 'id:wt-1', relativePath: MAP, navigation: 'caller' }
    ])
    expect(vi.mocked(console.log).mock.calls[0][0]).toBe(`Opened ${MAP}.`)
  })

  it('rejects a non-HTML path before any RPC call', async () => {
    await main(['file', 'open', 'src/App.tsx', '--preview', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    const message = vi.mocked(console.error).mock.calls[0][0]
    expect(message).toContain('src/App.tsx')
    expect(message).toContain('--preview renders only .html or .htm files')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('rejects --preview with --line before any RPC call', async () => {
    await main(
      ['file', 'open', MAP, '--preview', '--line', '3', '--worktree', 'id:wt-1'],
      '/tmp/repo'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(
      '--preview cannot be combined with --line or --column'
    )
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('keeps the path that follows --preview', async () => {
    queueFixtures(callMock, openResult({ preview: true }))

    await main(['file', 'open', '--preview', MAP, '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith(
      'files.open',
      expect.objectContaining({ relativePath: MAP, preview: true })
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects a valued --preview instead of silently opening source', async () => {
    await main(['file', 'open', MAP, '--preview=false', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(
      '--preview takes no value, but got "false"'
    )
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('never opens source when a stray token follows --preview', async () => {
    await main(['file', 'open', MAP, '--preview', 'stray', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('accepts an upper-case .HTM extension', async () => {
    queueFixtures(callMock, openResult({ relativePath: 'docs/MAP.HTM', preview: true }))

    await main(['file', 'open', 'docs/MAP.HTM', '--preview', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith(
      'files.open',
      expect.objectContaining({ relativePath: 'docs/MAP.HTM', preview: true })
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('fails when the host does not echo preview (older Orca opened source)', async () => {
    queueFixtures(callMock, openResult())

    await main(['file', 'open', MAP, '--preview', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(console.log).not.toHaveBeenCalled()
    const message = vi.mocked(console.error).mock.calls[0][0]
    expect(message).toContain('does not support --preview')
    expect(message).toContain('Update Orca')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('reports the missing echo as ok:false in --json mode', async () => {
    queueFixtures(callMock, openResult())

    await main(['file', 'open', MAP, '--preview', '--worktree', 'id:wt-1', '--json'], '/tmp/repo')

    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0])
    expect(output).toMatchObject({ ok: false })
    expect(output.error.message).toContain('does not support --preview')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })
})
