import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import { persistWorktreeSortOrderByHost } from '@/lib/worktree-sort-order-persistence'
import { splitWorktreeSortOrderByHost } from '@/lib/worktree-sort-order-host-split'
import { splitWorktreeSortOrderForThisWindow } from './second-window-sort-order'

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: vi.fn()
}))

const localPersistSortOrder = vi.fn()
const runtimeCall = vi.mocked(callRuntimeRpc)

const state: WorktreeRuntimeOwnerState = {
  settings: { activeRuntimeEnvironmentId: 'host-env' },
  repos: [
    { id: 'local-repo', connectionId: null, executionHostId: 'local' },
    { id: 'host-repo', connectionId: null, executionHostId: 'runtime:host-env' },
    { id: 'other-repo', connectionId: null, executionHostId: 'runtime:other-env' }
  ],
  worktreesByRepo: {
    'local-repo': [{ id: 'local-repo::wt-a', repoId: 'local-repo' }],
    'host-repo': [
      { id: 'host-repo::wt-b', repoId: 'host-repo' },
      { id: 'host-repo::wt-c', repoId: 'host-repo' }
    ],
    'other-repo': [{ id: 'other-repo::wt-d', repoId: 'other-repo' }]
  }
}
const ORDER = ['host-repo::wt-c', 'local-repo::wt-a', 'other-repo::wt-d', 'host-repo::wt-b']

function stubWindow(joseWindow?: { isSecondWindow: boolean }): void {
  vi.stubGlobal('window', {
    api: { worktrees: { persistSortOrder: localPersistSortOrder } },
    ...(joseWindow ? { joseWindow } : {})
  })
}

beforeEach(() => {
  runtimeCall.mockReset()
  localPersistSortOrder.mockReset()
  runtimeCall.mockResolvedValue(undefined)
  localPersistSortOrder.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('smart sort persistence per window', () => {
  it('a second window skips every runtime write and still persists its local worktrees', () => {
    stubWindow({ isSecondWindow: true })
    persistWorktreeSortOrderByHost(state, ORDER)

    expect(runtimeCall).not.toHaveBeenCalled()
    expect(localPersistSortOrder).toHaveBeenCalledTimes(1)
    expect(localPersistSortOrder).toHaveBeenCalledWith({ orderedIds: ['local-repo::wt-a'] })
  })

  it.each([
    ['the host window', { isSecondWindow: false }],
    ['an ordinary paired client', undefined]
  ])('%s keeps the upstream split and calls unchanged', (_label, joseWindow) => {
    stubWindow(joseWindow)
    expect(splitWorktreeSortOrderForThisWindow(state, ORDER)).toEqual(
      splitWorktreeSortOrderByHost(state, ORDER)
    )

    persistWorktreeSortOrderByHost(state, ORDER)
    expect(runtimeCall.mock.calls).toEqual([
      [
        { kind: 'environment', environmentId: 'host-env' },
        'worktree.persistSortOrder',
        { orderedIds: ['host-repo::wt-c', 'host-repo::wt-b'] },
        { timeoutMs: 15_000 }
      ],
      [
        { kind: 'environment', environmentId: 'other-env' },
        'worktree.persistSortOrder',
        { orderedIds: ['other-repo::wt-d'] },
        { timeoutMs: 15_000 }
      ]
    ])
    expect(localPersistSortOrder.mock.calls).toEqual([[{ orderedIds: ['local-repo::wt-a'] }]])
  })
})
