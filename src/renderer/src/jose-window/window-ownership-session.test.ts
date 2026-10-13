import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  JoseWindowNavigationIntent,
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { Worktree } from '../../../shared/worktree/types'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { isOwnedByAnotherWindow } from './ownership-guard'
import type { OwnershipSubscriptionCallbacks } from './window-ownership-client'
import {
  resetWindowOwnershipLogForTests,
  startWindowOwnership,
  type WindowOwnershipDeps
} from './window-ownership-session'

const initialAppStoreState = useAppStore.getState()
const LOCAL = { kind: 'local' } as const
const local = (worktreeId: string): JoseWindowWorktreeRef => ({
  worktreeId,
  executionHostId: 'local'
})
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function worktree(id: string, repoId: string): Worktree {
  return {
    id,
    repoId,
    path: `/workspace/${id}`,
    head: 'abc123',
    branch: `refs/heads/${id}`,
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function seedStore(activeWorktreeId: string | null): ReturnType<typeof vi.fn> {
  const setActiveWorktree = vi.fn((id: string | null) => {
    useAppStore.setState({ activeWorktreeId: id })
    return true
  })
  useAppStore.setState({
    repos: [
      { id: 'repo', path: '/r', displayName: 'r', badgeColor: '#000', addedAt: 0 },
      {
        id: 'remote-repo',
        path: '/x',
        displayName: 'x',
        badgeColor: '#000',
        addedAt: 0,
        executionHostId: 'runtime:other-env'
      }
    ],
    worktreesByRepo: {
      repo: [worktree('repo::a', 'repo'), worktree('repo::b', 'repo')],
      'remote-repo': [worktree('remote-repo::z', 'remote-repo')]
    },
    activeWorktreeId,
    setActiveWorktree
  })
  return setActiveWorktree
}

function harness(
  claimResult: (ref: JoseWindowWorktreeRef | null) => boolean | Promise<boolean> = () => true
) {
  let callbacks: OwnershipSubscriptionCallbacks | null = null
  const unsubscribe = vi.fn()
  const timers: (() => void)[] = []
  const deps = {
    store: useAppStore,
    subscribe: vi.fn(async (_target, next: OwnershipSubscriptionCallbacks) => {
      callbacks = next
      return { unsubscribe }
    }),
    claim: vi.fn(async (_target, ref: JoseWindowWorktreeRef | null) => claimResult(ref)),
    reveal: vi.fn(async () => true),
    raise: vi.fn(),
    applyIntent: vi.fn<(request: JoseWindowIntentRequest) => void>(),
    activateHere: vi.fn<(worktreeId: string, executionHostId: string | undefined) => void>(),
    isMissingMethod: (error: unknown) => error === 'method_not_found',
    setTimer: (callback: () => void) => {
      timers.push(callback)
      return () => {}
    }
  } satisfies WindowOwnershipDeps
  const frame = (next: JoseWindowOwnershipFrame): void => callbacks?.onFrame(next)
  return { deps, frame, unsubscribe, timers, callbacks: () => callbacks }
}

beforeEach(() => resetWindowOwnershipLogForTests())
afterEach(() => useAppStore.setState(initialAppStoreState, true))

describe('startWindowOwnership', () => {
  it('claims the active worktree once the host snapshot arrives and on every change', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    expect(h.deps.claim).not.toHaveBeenCalled()

    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    expect(h.deps.claim).toHaveBeenLastCalledWith(LOCAL, local('repo::a'))

    useAppStore.setState({ activeWorktreeId: 'repo::b' })
    await flush()
    expect(h.deps.claim).toHaveBeenLastCalledWith(LOCAL, local('repo::b'))
    stop()
  })

  it('deselects when the host refuses the claim', async () => {
    const setActiveWorktree = seedStore('repo::a')
    const h = harness((ref) => ref?.worktreeId !== 'repo::a')
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: ['repo::a'], ownedHere: null })
    await flush()

    expect(setActiveWorktree).toHaveBeenCalledWith(null)
    expect(useAppStore.getState().activeWorktreeId).toBeNull()
    expect(isOwnedByAnotherWindow('repo::a')).toBe(true)
    stop()
    expect(isOwnedByAnotherWindow('repo::a')).toBe(false)
  })

  it('re-claims after the host dropped the claim on a reconnect', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: 'repo::a' })
    await flush()
    expect(h.deps.claim).toHaveBeenCalledTimes(1)

    h.callbacks()?.onClose()
    expect(isOwnedByAnotherWindow('repo::a')).toBe(false)
    h.timers.shift()?.()
    await flush()
    expect(h.deps.subscribe).toHaveBeenCalledTimes(2)
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    expect(h.deps.claim).toHaveBeenCalledTimes(2)
    stop()
  })

  it('releases the claim when the selection moves to the same id on another host', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()

    useAppStore.setState({ activeWorkspaceExecutionHostId: 'runtime:other-env' })
    await flush()

    expect(h.deps.claim.mock.calls.map(([, ref]) => ref)).toEqual([local('repo::a'), null])
    stop()
  })

  it('drops a claim reply that crossed a reconnect and re-claims on the new stream', async () => {
    seedStore('repo::a')
    let resolveFirstClaim: (claimed: boolean) => void = () => {}
    const h = harness()
    h.deps.claim.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirstClaim = resolve
        })
    )
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()

    // The stream drops while the claim is in flight; the host releases A and the new stream says so.
    h.callbacks()?.onClose()
    h.timers.shift()?.()
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    resolveFirstClaim(true)
    await flush()

    expect(h.deps.claim.mock.calls.map(([, ref]) => ref?.worktreeId)).toEqual([
      'repo::a',
      'repo::a'
    ])
    stop()
  })

  it('shows the workspace surface before raising, when the reveal is for its worktree', async () => {
    seedStore('repo::a')
    useAppStore.setState({ activeView: 'settings' })
    const h = harness()
    const viewsAtRaise: string[] = []
    h.deps.raise.mockImplementation(() => {
      viewsAtRaise.push(useAppStore.getState().activeView)
    })
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'reveal', worktreeId: 'repo::a', executionHostId: 'local' })
    stop()
    expect(viewsAtRaise).toEqual(['terminal'])
  })

  it('carries out a redirected file open after checking it still owns the worktree', async () => {
    seedStore('remote-repo::z')
    useAppStore.setState({ activeWorkspaceExecutionHostId: 'runtime:other-env' })
    const target: RuntimeClientTarget = { kind: 'environment', environmentId: 'other-env' }
    const h = harness()
    const stop = startWindowOwnership(target, h.deps)
    await flush()
    h.frame({
      type: 'reveal',
      worktreeId: 'remote-repo::z',
      executionHostId: 'local',
      intent: { kind: 'file', filePath: '/x/z/a.ts', relativePath: 'a.ts' }
    })
    stop()

    expect({
      applied: h.deps.applyIntent.mock.calls,
      raised: h.deps.raise.mock.calls.length
    }).toEqual({
      applied: [
        [
          {
            worktreeId: 'remote-repo::z',
            runtimeEnvironmentId: 'other-env',
            intent: { kind: 'file', filePath: '/x/z/a.ts', relativePath: 'a.ts' }
          }
        ]
      ],
      raised: 1
    })
  })

  it('focuses the requested terminal pane, not just the worktree', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    const intent: JoseWindowNavigationIntent = {
      kind: 'terminal',
      tabId: 'tab-2',
      leafId: 'leaf-3'
    }
    h.frame({ type: 'reveal', worktreeId: 'repo::a', executionHostId: 'local', intent })
    stop()

    expect(h.deps.applyIntent).toHaveBeenCalledWith({ worktreeId: 'repo::a', intent })
  })

  it('ignores a reveal for a worktree this window has since left', async () => {
    seedStore('repo::b')
    useAppStore.setState({ activeView: 'tasks' })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'reveal', worktreeId: 'repo::a', executionHostId: 'local' })
    stop()
    vi.restoreAllMocks()
    expect({
      raised: h.deps.raise.mock.calls.length,
      view: useAppStore.getState().activeView,
      active: useAppStore.getState().activeWorktreeId
    }).toEqual({ raised: 0, view: 'tasks', active: 'repo::b' })
  })

  it('treats a host without the methods as no ownership and logs once', async () => {
    seedStore('repo::a')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const h = harness()
    h.deps.subscribe.mockImplementation(async (_target, next) => {
      next.onError('method_not_found')
      return { unsubscribe: h.unsubscribe }
    })
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    const stop2 = startWindowOwnership(LOCAL, h.deps)
    await flush()

    expect(h.deps.claim).not.toHaveBeenCalled()
    expect(isOwnedByAnotherWindow('repo::a')).toBe(false)
    expect(h.timers).toHaveLength(0)
    expect(info).toHaveBeenCalledTimes(1)
    stop()
    stop2()
    info.mockRestore()
  })

  it('stops claiming when a claim hits a host without the method', async () => {
    seedStore('repo::a')
    const h = harness()
    h.deps.claim.mockRejectedValueOnce('method_not_found')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    useAppStore.setState({ activeWorktreeId: 'repo::b' })
    await flush()
    expect(h.deps.claim).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).toHaveBeenCalled()
    stop()
    vi.restoreAllMocks()
  })
})
