import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../shared/worktree/types'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { redirectIfOwnedElsewhere, setWindowOwnershipView } from './ownership-guard'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  setWindowOwnershipView(null)
  useAppStore.setState(initialAppStoreState, true)
})

function worktree(id: string): Worktree {
  return {
    id,
    repoId: 'repo-1',
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

function seed(): { setActiveWorktree: ReturnType<typeof vi.fn> } {
  const setActiveWorktree = vi.fn()
  useAppStore.setState({
    repos: [
      { id: 'repo-1', path: '/workspace', displayName: 'repo', badgeColor: '#000', addedAt: 0 }
    ],
    worktreesByRepo: { 'repo-1': [worktree('repo-1::a'), worktree('repo-1::b')] },
    activeRepoId: 'repo-1',
    activeView: 'terminal',
    activeWorktreeId: 'repo-1::b',
    tabsByWorktree: {},
    setActiveWorktree,
    markWorktreeVisited: vi.fn(),
    recordWorktreeVisit: vi.fn(),
    revealWorktreeInSidebar: vi.fn()
  })
  return { setActiveWorktree }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('window ownership activation guard', () => {
  it('reveals the owning window instead of activating a worktree it owns', () => {
    const { setActiveWorktree } = seed()
    const reveal = vi.fn(async () => true)
    setWindowOwnershipView({ link: { reveal }, ownedElsewhere: ['repo-1::a'] })

    expect(activateAndRevealWorktree('repo-1::a')).toEqual({ primaryTabId: null })

    expect(reveal).toHaveBeenCalledWith('repo-1::a')
    expect(setActiveWorktree).not.toHaveBeenCalled()
  })

  it('raises the owner on back/forward history too, without opening the worktree here', () => {
    const { setActiveWorktree } = seed()
    useAppStore.setState({ isNavigatingHistory: true })
    const reveal = vi.fn(async () => true)
    setWindowOwnershipView({ link: { reveal }, ownedElsewhere: ['repo-1::a'] })

    expect(activateAndRevealWorktree('repo-1::a')).toEqual({ primaryTabId: null })

    expect(reveal).toHaveBeenCalledWith('repo-1::a')
    expect(setActiveWorktree).not.toHaveBeenCalled()
  })

  it('activates normally when ownership is unknown or the worktree is free', () => {
    const { setActiveWorktree } = seed()
    activateAndRevealWorktree('repo-1::a')
    expect(setActiveWorktree).toHaveBeenCalledWith('repo-1::a', undefined)

    const reveal = vi.fn(async () => true)
    setWindowOwnershipView({ link: { reveal }, ownedElsewhere: ['repo-1::other'] })
    expect(redirectIfOwnedElsewhere('repo-1::a')).toBe(false)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('opens the worktree here when the host found no owner to raise', async () => {
    seed()
    const activateHere = vi.fn()
    setWindowOwnershipView({
      link: { reveal: async () => false, activateHere },
      ownedElsewhere: ['repo-1::a']
    })

    expect(redirectIfOwnedElsewhere('repo-1::a')).toBe(true)
    await flush()

    expect(activateHere).toHaveBeenCalledWith('repo-1::a')
    expect(redirectIfOwnedElsewhere('repo-1::a')).toBe(false)
  })
})
