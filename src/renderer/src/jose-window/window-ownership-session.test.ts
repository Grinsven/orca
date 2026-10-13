import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JoseWindowOwnershipFrame } from '../../../shared/rpc-contract/jose-window-params'
import type { Worktree } from '../../../shared/worktree/types'
import { useAppStore } from '@/store'
import { isOwnedByAnotherWindow } from './ownership-guard'
import type { OwnershipSubscriptionCallbacks } from './window-ownership-client'
import {
  claimableWorktreeId,
  resetWindowOwnershipLogForTests,
  startWindowOwnership,
  type WindowOwnershipDeps
} from './window-ownership-session'

const initialAppStoreState = useAppStore.getState()
const LOCAL = { kind: 'local' } as const
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
  claimResult: (worktreeId: string | null) => boolean | Promise<boolean> = () => true
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
    claim: vi.fn(async (_target, worktreeId: string | null) => claimResult(worktreeId)),
    reveal: vi.fn(async () => true),
    raise: vi.fn(),
    activateHere: vi.fn(),
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

describe('claimableWorktreeId', () => {
  it('claims only worktrees served by the ownership host', () => {
    seedStore('repo::a')
    expect(claimableWorktreeId(useAppStore.getState(), LOCAL)).toBe('repo::a')
    useAppStore.setState({ activeWorktreeId: 'remote-repo::z' })
    expect(claimableWorktreeId(useAppStore.getState(), LOCAL)).toBeNull()
    expect(
      claimableWorktreeId(useAppStore.getState(), {
        kind: 'environment',
        environmentId: 'other-env'
      })
    ).toBe('remote-repo::z')
  })
})

describe('startWindowOwnership', () => {
  it('claims the active worktree once the host snapshot arrives and on every change', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    expect(h.deps.claim).not.toHaveBeenCalled()

    h.frame({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    await flush()
    expect(h.deps.claim).toHaveBeenLastCalledWith(LOCAL, 'repo::a')

    useAppStore.setState({ activeWorktreeId: 'repo::b' })
    await flush()
    expect(h.deps.claim).toHaveBeenLastCalledWith(LOCAL, 'repo::b')
    stop()
  })

  it('deselects when the host refuses the claim', async () => {
    const setActiveWorktree = seedStore('repo::a')
    const h = harness((worktreeId) => worktreeId !== 'repo::a')
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

  it('raises this window when the host forwards a reveal', async () => {
    seedStore('repo::a')
    const h = harness()
    const stop = startWindowOwnership(LOCAL, h.deps)
    await flush()
    h.frame({ type: 'reveal', worktreeId: 'repo::a' })
    expect(h.deps.raise).toHaveBeenCalledTimes(1)
    stop()
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
