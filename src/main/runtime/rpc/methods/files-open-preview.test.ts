import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { FILE_METHODS } from './files'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function createDispatcher(): {
  runtime: Pick<OrcaRuntimeService, 'openMobileFile' | 'openMobileDiff'>
  dispatcher: RpcDispatcher
} {
  const opened = { worktree: 'wt-1', relativePath: 'map.html', kind: 'text', opened: true }
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    openMobileFile: vi.fn().mockResolvedValue({ ...opened, preview: true }),
    openMobileDiff: vi.fn().mockResolvedValue(opened)
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FILE_METHODS open handlers only read the stubbed members.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: FILE_METHODS
  })
  return { runtime, dispatcher }
}

describe('files.open preview param', () => {
  it('passes preview to the runtime and returns its echo', async () => {
    const { runtime, dispatcher } = createDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest('files.open', {
        worktree: 'id:wt-1',
        relativePath: 'map.html',
        navigation: 'caller',
        preview: true
      })
    )

    expect(runtime.openMobileFile).toHaveBeenCalledWith(
      'id:wt-1',
      'map.html',
      'caller',
      undefined,
      true
    )
    expect(response).toMatchObject({ ok: true, result: { preview: true } })
  })

  it('calls the runtime with the original three arguments when preview is absent or false', async () => {
    const { runtime, dispatcher } = createDispatcher()

    await dispatcher.dispatch(
      makeRequest('files.open', { worktree: 'id:wt-1', relativePath: 'map.html' })
    )
    await dispatcher.dispatch(
      makeRequest('files.open', { worktree: 'id:wt-1', relativePath: 'map.html', preview: false })
    )

    expect(vi.mocked(runtime.openMobileFile).mock.calls).toEqual([
      ['id:wt-1', 'map.html', undefined],
      ['id:wt-1', 'map.html', undefined]
    ])
  })

  it('rejects a non-boolean preview', async () => {
    const { runtime, dispatcher } = createDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest('files.open', { worktree: 'id:wt-1', relativePath: 'map.html', preview: 'yes' })
    )

    expect(response).toMatchObject({ ok: false })
    expect(runtime.openMobileFile).not.toHaveBeenCalled()
  })

  it('leaves files.openDiff unaware of preview', async () => {
    const { runtime, dispatcher } = createDispatcher()

    await dispatcher.dispatch(
      makeRequest('files.openDiff', {
        worktree: 'id:wt-1',
        relativePath: 'map.html',
        staged: true,
        preview: true
      })
    )

    expect(vi.mocked(runtime.openMobileDiff).mock.calls).toEqual([
      ['id:wt-1', 'map.html', true, undefined]
    ])
  })
})
