import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeNavigationTarget } from '../../../../shared/runtime-navigation'
import { createTestStore, makeWorktree, seedStore } from '../../store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../../store/slices/store-session-test-harness'

const mocks = vi.hoisted(() => {
  const state: { store: ReturnType<typeof createTestStore> | null } = { store: null }
  return Object.assign(state, { openWorkspaceFilePreview: vi.fn(), toastError: vi.fn() })
})

function testStore(): ReturnType<typeof createTestStore> {
  if (!mocks.store) {
    throw new Error('test store not created')
  }
  return mocks.store
}

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: mocks.toastError } }))
vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => testStore().getState(),
    setState: (...args: Parameters<ReturnType<typeof createTestStore>['setState']>) =>
      testStore().setState(...args)
  }
}))
vi.mock('@/lib/workspace-file-preview-open', () => ({
  openWorkspaceFilePreview: mocks.openWorkspaceFilePreview
}))
vi.mock('@/components/terminal-pane/closed-terminal-leaf-notice', () => ({
  applyClosedTerminalLeafNotice: vi.fn()
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('@/components/sidebar/sleep-worktree-flow', () => ({ runSleepWorktree: vi.fn() }))
vi.mock('@/lib/workspace-session', () => ({ buildWorkspaceSessionPayload: vi.fn() }))
vi.mock('@/lib/workspace-session-host-persistence', () => ({
  persistWorkspaceSessionByHost: vi.fn()
}))

import { registerMobileAndTerminalCloseIpcBridge } from './mobile-terminal-close-ipc-bridge'

type OpenFilePayload = {
  worktreeId: string
  filePath: string
  relativePath: string
  runtimeEnvironmentId?: string
  navigation?: RuntimeNavigationTarget
  preview?: true
}

const VIEWED = 'repo1::/repo1/viewed'
const BACKGROUND = 'repo1::/repo1/background'
const MAP = { filePath: '/repo1/background/docs/map.html', relativePath: 'docs/map.html' }

function setup(): (payload: OpenFilePayload) => void {
  let openFile: ((payload: OpenFilePayload) => void) | undefined
  vi.stubGlobal('window', {
    api: {
      ...createStoreSessionMockApi(),
      ui: {
        onOpenFileFromMobile: (cb: (payload: OpenFilePayload) => void) => {
          openFile = cb
          return () => {}
        },
        onOpenDiffFromMobile: () => () => {},
        onCloseTerminal: () => () => {},
        onSleepWorktree: () => () => {},
        onResumeSleepingAgents: () => () => {}
      }
    }
  })
  const store = createTestStore()
  mocks.store = store
  seedStore(store, {
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: VIEWED, repoId: 'repo1', path: '/repo1/viewed' }),
        makeWorktree({ id: BACKGROUND, repoId: 'repo1', path: '/repo1/background' })
      ]
    }
  })
  store.getState().setActiveWorktree(VIEWED)
  store.getState().createTab(VIEWED)
  store.getState().setActiveTabType('terminal', VIEWED)
  store.setState({ activeView: 'terminal', pendingRevealWorktree: null })
  registerMobileAndTerminalCloseIpcBridge([], vi.fn())
  if (!openFile) {
    throw new Error('file-open listener was not registered')
  }
  return openFile
}

function screenState(): unknown {
  const s = testStore().getState()
  return {
    activeWorktreeId: s.activeWorktreeId,
    activeView: s.activeView,
    activeTabType: s.activeTabType,
    activeFileId: s.activeFileId,
    activeTabId: s.activeTabId,
    pendingRevealWorktree: s.pendingRevealWorktree,
    backgroundVisitedAt: s.lastVisitedAtByWorktreeId[BACKGROUND]
  }
}

function backgroundEditorPaths(): string[] {
  return testStore()
    .getState()
    .openFiles.filter((file) => file.worktreeId === BACKGROUND)
    .map((file) => file.filePath)
}

describe('runtime file preview opens on the host desktop', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mocks.openWorkspaceFilePreview.mockReset()
    mocks.openWorkspaceFilePreview.mockReturnValue({ status: 'opened', reused: false })
    mocks.toastError.mockReset()
  })

  it('hands a preview to the preview opener instead of opening source', () => {
    const openFile = setup()

    openFile({ worktreeId: BACKGROUND, ...MAP, navigation: 'caller', preview: true })

    expect(mocks.openWorkspaceFilePreview).toHaveBeenCalledWith({
      filePath: MAP.filePath,
      worktreeId: BACKGROUND,
      focus: false
    })
    expect(backgroundEditorPaths()).toEqual([])
  })

  it('a CLI caller preview does not move the desktop', () => {
    const openFile = setup()
    const before = screenState()

    openFile({ worktreeId: BACKGROUND, ...MAP, navigation: 'caller', preview: true })

    expect(screenState()).toEqual(before)
  })

  it.each([
    [undefined, true],
    ['all', true],
    ['host', true],
    ['caller', false],
    ['clients', false]
  ] as const)('navigation %s asks for focus %s', (navigation, focus) => {
    const openFile = setup()

    openFile({
      worktreeId: BACKGROUND,
      ...MAP,
      preview: true,
      ...(navigation ? { navigation } : {})
    })

    expect(mocks.openWorkspaceFilePreview).toHaveBeenCalledWith(expect.objectContaining({ focus }))
  })

  it('opens source exactly as before when preview is absent', () => {
    const openFile = setup()
    const before = screenState()

    openFile({ worktreeId: BACKGROUND, ...MAP, navigation: 'caller' })

    expect(mocks.openWorkspaceFilePreview).not.toHaveBeenCalled()
    expect(backgroundEditorPaths()).toEqual([MAP.filePath])
    expect(screenState()).toEqual(before)
  })

  it('falls back to the source tab and says why when the preview is unsupported', () => {
    mocks.openWorkspaceFilePreview.mockReturnValue({
      status: 'unsupported',
      message: "Files outside the workspace can't be previewed on a paired server yet."
    })
    const openFile = setup()
    const before = screenState()

    openFile({ worktreeId: BACKGROUND, ...MAP, navigation: 'caller', preview: true })

    expect(backgroundEditorPaths()).toEqual([MAP.filePath])
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Files outside the workspace can't be previewed on a paired server yet."
    )
    expect(screenState()).toEqual(before)
  })

  it('an unsupported focused preview switches to the source tab like a plain open', () => {
    mocks.openWorkspaceFilePreview.mockReturnValue({ status: 'unsupported', message: 'No.' })
    const openFile = setup()

    openFile({ worktreeId: BACKGROUND, ...MAP, navigation: 'all', preview: true })

    expect(testStore().getState().activeWorktreeId).toBe(BACKGROUND)
    expect(testStore().getState().activeFileId).toBe(MAP.filePath)
    expect(testStore().getState().activeTabType).toBe('editor')
  })
})
