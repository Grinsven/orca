import { describe, expect, it, vi } from 'vitest'
import { resolveAuthorizedPathMock, statMock } from './orca-runtime-files-mock-registry'
import {
  createRuntimeFileCommands,
  useRuntimeFileCommandsLifecycle
} from './orca-runtime-files-test-harness'

vi.mock('fs', async () => (await import('./orca-runtime-files-mock-registry')).fsModuleMock())
vi.mock('fs/promises', async () =>
  (await import('./orca-runtime-files-mock-registry')).fsPromisesModuleMock()
)
vi.mock(
  './file-watcher-host',
  async () => (await import('./orca-runtime-files-mock-registry')).fileWatcherHostMock
)
vi.mock('../ipc/filesystem-auth', async () =>
  (await import('./orca-runtime-files-mock-registry')).filesystemAuthModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./orca-runtime-files-mock-registry')).gitRunnerModuleMock()
)
vi.mock(
  '../ipc/local-worktree-runtime-options',
  async () => (await import('./orca-runtime-files-mock-registry')).localWorktreeRuntimeOptionsMock
)

describe('RuntimeFileCommands.openMobileFile preview', () => {
  useRuntimeFileCommandsLifecycle()

  it('refuses a non-HTML preview before resolving or opening anything', async () => {
    const openFile = vi.fn()
    const resolveRuntimeFileTarget = vi.fn()
    const { commands } = createRuntimeFileCommands({ openFile, resolveRuntimeFileTarget })

    await expect(
      commands.openMobileFile('id:wt-1', 'src/app.ts', 'caller', undefined, true)
    ).rejects.toThrow('Cannot preview src/app.ts: only .html or .htm files render as a page.')
    expect(resolveRuntimeFileTarget).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('threads preview to the renderer host without a position and echoes it', async () => {
    const openFile = vi.fn()
    const { commands } = createRuntimeFileCommands({ openFile })
    resolveAuthorizedPathMock.mockResolvedValue('/repo/docs/map.HTML')
    statMock.mockResolvedValue({ isDirectory: () => false })

    const result = await commands.openMobileFile(
      'id:wt-1',
      'docs/map.HTML',
      'caller',
      { line: 3 },
      true
    )

    expect(openFile).toHaveBeenCalledWith(
      'wt-1',
      '/repo/docs/map.HTML',
      'docs/map.HTML',
      null,
      'caller',
      undefined,
      true
    )
    expect(result).toEqual({
      worktree: 'wt-1',
      relativePath: 'docs/map.HTML',
      kind: 'text',
      opened: true,
      preview: true
    })
  })

  it('still refuses a directory named like an HTML file', async () => {
    const openFile = vi.fn()
    const { commands } = createRuntimeFileCommands({ openFile })
    resolveAuthorizedPathMock.mockResolvedValue('/repo/docs/gone.html')
    statMock.mockResolvedValue({ isDirectory: () => true })

    await expect(
      commands.openMobileFile('id:wt-1', 'docs/gone.html', undefined, undefined, true)
    ).rejects.toThrow('EISDIR')
    expect(openFile).not.toHaveBeenCalled()
  })

  it('keeps a plain open of an HTML file exactly as before', async () => {
    const openFile = vi.fn()
    const { commands } = createRuntimeFileCommands({ openFile })
    resolveAuthorizedPathMock.mockResolvedValue('/repo/docs/map.html')
    statMock.mockResolvedValue({ isDirectory: () => false })

    const result = await commands.openMobileFile('id:wt-1', 'docs/map.html', 'caller')

    expect(openFile.mock.calls).toEqual([
      ['wt-1', '/repo/docs/map.html', 'docs/map.html', null, 'caller']
    ])
    expect(result).toEqual({
      worktree: 'wt-1',
      relativePath: 'docs/map.html',
      kind: 'text',
      opened: true
    })
    expect(result).not.toHaveProperty('preview')
  })
})
