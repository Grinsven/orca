// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { makeFolderWorkspace, makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { ProjectMapToolbarButton } from './ProjectMapToolbarButton'

const mocks = vi.hoisted(() => {
  const state: Partial<AppState> = {}
  return { state, openWorkspaceFilePreview: vi.fn(), toastError: vi.fn() }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Partial<AppState>) => unknown) => selector(mocks.state)
}))

vi.mock('@/lib/workspace-file-preview-open', () => ({
  openWorkspaceFilePreview: mocks.openWorkspaceFilePreview
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

const MAP_PATH = '/srv/repo/docs/project-map.html'
const WORKTREE_ID = 'repo-1::/srv/repo'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/srv/repo',
    displayName: 'Repo',
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

function stateWith(repo: Repo, activeWorktreeId: string | null): Partial<AppState> {
  return {
    repos: [repo],
    activeRepoId: repo.id,
    activeWorktreeId,
    activeWorkspaceExecutionHostId: null,
    worktreesByRepo: { [repo.id]: [makeWorktree({ id: WORKTREE_ID, repoId: repo.id })] },
    detectedWorktreesByRepo: {},
    folderWorkspaces: [makeFolderWorkspace({ id: 'folder-1' })],
    floatingWorkspacePath: null
  }
}

const roots: Root[] = []

async function renderButton(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<ProjectMapToolbarButton />)
  })
  return container
}

function findTrigger(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[data-project-map-trigger]')
}

describe('ProjectMapToolbarButton', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    mocks.openWorkspaceFilePreview.mockReturnValue({ status: 'opened', reused: false })
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('is hidden when the active repo has no project map', async () => {
    mocks.state = stateWith(makeRepo(), WORKTREE_ID)
    expect(findTrigger(await renderButton())).toBeNull()
  })

  it('is hidden when the project map path is blank', async () => {
    mocks.state = stateWith(makeRepo({ projectMapPath: '  ' }), WORKTREE_ID)
    expect(findTrigger(await renderButton())).toBeNull()
  })

  it('is hidden with no active worktree even when the active repo has a map', async () => {
    mocks.state = stateWith(makeRepo({ projectMapPath: MAP_PATH }), null)
    expect(findTrigger(await renderButton())).toBeNull()
  })

  it('is hidden for a folder workspace, which has no repo of its own', async () => {
    mocks.state = stateWith(makeRepo({ projectMapPath: MAP_PATH }), folderWorkspaceKey('folder-1'))
    expect(findTrigger(await renderButton())).toBeNull()
  })

  it('shows a labelled button when the active worktree repo has a map', async () => {
    mocks.state = stateWith(makeRepo({ projectMapPath: MAP_PATH }), WORKTREE_ID)
    const trigger = findTrigger(await renderButton())
    expect(trigger?.getAttribute('aria-label')).toBe('Project map')
  })

  it('shows the button for a folder-mode repo with a map', async () => {
    mocks.state = stateWith(makeRepo({ kind: 'folder', projectMapPath: MAP_PATH }), WORKTREE_ID)
    expect(findTrigger(await renderButton())).not.toBeNull()
  })

  it('opens the map in the active worktree with focus', async () => {
    mocks.state = stateWith(makeRepo({ projectMapPath: MAP_PATH }), WORKTREE_ID)
    const trigger = findTrigger(await renderButton())
    await act(async () => {
      trigger?.click()
    })
    expect(mocks.openWorkspaceFilePreview).toHaveBeenCalledExactlyOnceWith({
      filePath: MAP_PATH,
      worktreeId: WORKTREE_ID,
      focus: true
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows the unsupported message as an error toast', async () => {
    mocks.openWorkspaceFilePreview.mockReturnValue({
      status: 'unsupported',
      message: 'Cannot preview this file here.'
    })
    mocks.state = stateWith(makeRepo({ projectMapPath: MAP_PATH }), WORKTREE_ID)
    const trigger = findTrigger(await renderButton())
    await act(async () => {
      trigger?.click()
    })
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Cannot preview this file here.')
  })
})
