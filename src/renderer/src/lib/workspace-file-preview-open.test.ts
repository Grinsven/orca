import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FilePreviewModule from '@/lib/file-preview'
import type { WorkspaceFilePreviewPlan } from '@/lib/file-preview'
import { createTestStore, makeWorktree, seedStore } from '../store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../store/slices/store-session-test-harness'

const mocks = vi.hoisted(() => {
  const state: {
    store: ReturnType<typeof createTestStore> | null
    plan: WorkspaceFilePreviewPlan
  } = { store: null, plan: { status: 'doc-preview' } }
  return Object.assign(state, { activateAndRevealWorktree: vi.fn() })
})

function testStore(): ReturnType<typeof createTestStore> {
  if (!mocks.store) {
    throw new Error('test store not created')
  }
  return mocks.store
}

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => testStore().getState(),
    setState: (...args: Parameters<ReturnType<typeof createTestStore>['setState']>) =>
      testStore().setState(...args)
  }
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/file-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof FilePreviewModule>()
  return { ...actual, getWorkspaceFilePreviewPlan: () => mocks.plan }
})

import { webviewRegistry } from '@/components/browser-pane/host-guest/webview-registry'
import { openWorkspaceFilePreview } from './workspace-file-preview-open'

const WT = 'repo1::/repo1/wt'
const FILE = '/repo1/wt/docs/map.html'
const URL = 'file:///repo1/wt/docs/map.html'

type FakeWebview = {
  getWebContentsId: () => number
  reload: () => void
  reloadIgnoringCache: () => void
}

function liveWebview(): FakeWebview {
  return { getWebContentsId: vi.fn(() => 7), reload: vi.fn(), reloadIgnoringCache: vi.fn() }
}

function registerWebview(pageId: string, webview: FakeWebview): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the opener only calls getWebContentsId and reloadIgnoringCache.
  webviewRegistry.set(pageId, webview as unknown as Electron.WebviewTag)
}

function browserTabs(): { id: string; url: string; docLocation?: unknown }[] {
  return testStore().getState().browserTabsByWorktree[WT] ?? []
}

function onlyPageId(): string {
  const [tab] = browserTabs()
  const page = testStore().getState().browserPagesByWorkspace[tab.id]?.[0]
  if (!page) {
    throw new Error('no browser page')
  }
  return page.id
}

function screenState(): unknown {
  const s = testStore().getState()
  return {
    activeWorktreeId: s.activeWorktreeId,
    activeTabType: s.activeTabType,
    activeBrowserTabId: s.activeBrowserTabId,
    activeBrowserTab: s.activeBrowserTabIdByWorktree[WT] ?? null,
    activeTabTypeForWorktree: s.activeTabTypeByWorktree[WT],
    groups: s.groupsByWorktree[WT]?.map((group) => group.activeTabId)
  }
}

describe('openWorkspaceFilePreview', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { api: createStoreSessionMockApi() })
    webviewRegistry.clear()
    mocks.activateAndRevealWorktree.mockReset()
    mocks.plan = { status: 'browser-tab', url: URL, title: 'map.html' }
    const store = createTestStore()
    mocks.store = store
    seedStore(store, {
      worktreesByRepo: { repo1: [makeWorktree({ id: WT, repoId: 'repo1', path: '/repo1/wt' })] }
    })
    store.getState().setActiveWorktree(WT)
    store.getState().createTab(WT)
    store.getState().setActiveTabType('terminal', WT)
  })

  it('opens one focused browser tab the first time, the way a terminal Cmd-click does', () => {
    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(result).toEqual({ status: 'opened', reused: false })
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith(WT, {
      providesInitialSurface: true
    })
    expect(browserTabs()).toHaveLength(1)
    expect(browserTabs()[0].url).toBe(URL)
    expect(testStore().getState().activeBrowserTabIdByWorktree[WT]).toBe(browserTabs()[0].id)
    expect(testStore().getState().activeTabType).toBe('browser')
  })

  it('re-uses and reloads the tab on a second open instead of adding another', () => {
    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })
    const webview = liveWebview()
    registerWebview(onlyPageId(), webview)

    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(result).toEqual({ status: 'opened', reused: true })
    expect(browserTabs()).toHaveLength(1)
    expect(webview.reloadIgnoringCache).toHaveBeenCalledTimes(1)
  })

  it('brings a re-used tab back to the front when focused', () => {
    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })
    const previewTabId = browserTabs()[0].id
    testStore().getState().createBrowserTab(WT, 'https://example.com', { activate: true })
    expect(testStore().getState().activeBrowserTabIdByWorktree[WT]).not.toBe(previewTabId)

    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(testStore().getState().activeBrowserTabIdByWorktree[WT]).toBe(previewTabId)
  })

  it('treats a page scrolled to an anchor as the same document', () => {
    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })
    testStore().getState().setBrowserPageUrl(onlyPageId(), `${URL}#section-2`)

    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(result).toEqual({ status: 'opened', reused: true })
    expect(browserTabs()).toHaveLength(1)
  })

  it('re-uses a page whose guest is not mounted without failing', () => {
    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: false })).toEqual({
      status: 'opened',
      reused: true
    })
    expect(browserTabs()).toHaveLength(1)
  })

  it('opens in the background without changing the screen when focus is false', () => {
    const before = screenState()

    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: false })

    expect(result).toEqual({ status: 'opened', reused: false })
    expect(browserTabs()).toHaveLength(1)
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
    expect(screenState()).toEqual(before)
  })

  it('reloads a re-used tab without activating it when focus is false', () => {
    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: false })
    const webview = liveWebview()
    registerWebview(onlyPageId(), webview)
    const before = screenState()

    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: false })

    expect(result).toEqual({ status: 'opened', reused: true })
    expect(webview.reloadIgnoringCache).toHaveBeenCalledTimes(1)
    expect(screenState()).toEqual(before)
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('opens and then re-uses one doc-preview tab for SSH and paired workspaces', () => {
    mocks.plan = { status: 'doc-preview' }

    expect(openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })).toEqual({
      status: 'opened',
      reused: false
    })
    expect(browserTabs()).toHaveLength(1)
    expect(browserTabs()[0].docLocation).toEqual({
      kind: 'workspace-doc',
      worktreeId: WT,
      filePath: FILE
    })
    const webview = liveWebview()
    registerWebview(onlyPageId(), webview)

    expect(openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })).toEqual({
      status: 'opened',
      reused: true
    })
    expect(browserTabs()).toHaveLength(1)
    expect(webview.reloadIgnoringCache).toHaveBeenCalledTimes(1)
  })

  it('opens a doc preview in the background when focus is false', () => {
    mocks.plan = { status: 'doc-preview' }
    const before = screenState()

    openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: false })

    expect(browserTabs()).toHaveLength(1)
    expect(screenState()).toEqual(before)
  })

  it('returns the plan message and opens nothing when the preview is unsupported', () => {
    mocks.plan = { status: 'unsupported', message: 'Not here.', reason: 'outside-worktree' }

    const result = openWorkspaceFilePreview({ filePath: FILE, worktreeId: WT, focus: true })

    expect(result).toEqual({ status: 'unsupported', message: 'Not here.' })
    expect(browserTabs()).toHaveLength(0)
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
  })
})
