// @vitest-environment happy-dom
import { useCallback, useEffect, useRef, useState } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeTab, makeTabGroup, makeUnifiedTab } from '@/store/slices/store-session-test-harness'
import {
  makeFolderWorkspace,
  makeWorktree,
  TEST_REPO
} from '@/store/slices/worktrees-slice-test-fixtures'
import { TerminalOverlaySlot } from '@/components/terminal-pane/TerminalOverlaySlot'
import { useExpandCollapseActions } from '@/components/terminal-pane/expand-collapse'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { planSplitLayout, useSplitWorktreeState } from './split-worktree-state'
import { useSplitGroupFocus } from './split-worktree-surface'
import { closeSplitWorktree, focusSplitWorkspace } from './split-worktree-actions'
import { useSplitWorktreeLifecycle } from './split-worktree-lifecycle'
import { saveSplitWorktreeLayout, splitPersistenceKey } from './split-worktree-persistence'
import {
  bindWindowWorkspaceClaimSession,
  publishWindowWorkspaceClaims
} from '@/jose-window/window-workspace-claims'
import { takeAllPendingManualTerminalWorktreeParks } from '@/lib/manual-terminal-worktree-parking'
import { createBrowserUuid } from '@/lib/browser-uuid'

const original = useAppStore.getState()
const originalSplit = useSplitWorktreeState.getState()
const a = { worktreeId: 'workspace-a', executionHostId: 'local' as const }
const b = { worktreeId: 'workspace-b', executionHostId: 'local' as const }
const tabId = 'terminal-b'
const groupId = 'group-b'
const leafId = '00000000-0000-4000-8000-000000000001'
const layout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'leaf', leafId },
    second: { type: 'leaf', leafId: '00000000-0000-4000-8000-000000000002' }
  },
  activeLeafId: leafId,
  expandedLeafId: leafId
}
let mounts = 0
let stopClaims = (): void => {}

// Replace only the native terminal: its PTY has not reattached when mount restores focus.
vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: ({ isActive }: { isActive: boolean }) => <ReconnectingPane isActive={isActive} />
}))

function ReconnectingPane({ isActive }: { isActive: boolean }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const initiallyActive = useRef(isActive)
  const expandedPaneIdRef = useRef<number | null>(null)
  const expandedStyleSnapshotRef = useRef(new Map<HTMLElement, { display: string; flex: string }>())
  const containerRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<PaneManager | null>(null)
  const pendingPaneSizeRefreshFrameIdsRef = useRef<number[]>([])
  const [, setExpandedPaneId] = useState<number | null>(null)
  const persistLayoutSnapshot = useCallback(() => {
    useAppStore.getState().setTabLayout(tabId, { ...layout })
  }, [])
  const { setExpandedPane } = useExpandCollapseActions({
    tabId,
    expandedPaneIdRef,
    expandedStyleSnapshotRef,
    containerRef,
    managerRef,
    pendingPaneSizeRefreshFrameIdsRef,
    setExpandedPaneId,
    setTabPaneExpanded: useAppStore.getState().setTabPaneExpanded,
    persistLayoutSnapshot
  })
  useEffect(() => {
    mounts += 1
    setExpandedPane(1)
    useAppStore.getState().setTabCanExpandPane(tabId, true)
    // Bound a broken passive-effect loop if React does not throw first.
    if (initiallyActive.current && mounts < 100) {
      input.current?.focus()
    }
    return () => {
      useAppStore.getState().setTabPaneExpanded(tabId, false)
      useAppStore.getState().setTabCanExpandPane(tabId, false)
    }
  }, [setExpandedPane])
  return <input ref={input} aria-label="Reconnecting terminal" />
}

function RetainedTerminal(): React.JSX.Element {
  const generation = useAppStore((state) => state.tabsByWorktree[b.worktreeId]?.[0]?.generation)
  const active = useAppStore((state) => state.activeWorktreeId === b.worktreeId)
  const focusGroup = useCallback((id: string) => {
    useAppStore.getState().focusGroup(b.worktreeId, id)
  }, [])
  const onFocusOwningGroup = useSplitGroupFocus(b.worktreeId, focusGroup)
  return (
    <TerminalOverlaySlot
      terminalTabId={tabId}
      terminalGeneration={generation}
      worktreeId={b.worktreeId}
      worktreePath="/workspace-b"
      startupCwd={undefined}
      groupId={groupId}
      isWorktreeActive={active}
      isVisible={active}
      isActive={active}
      activityTerminalPortal={null}
      onFocusOwningGroup={onFocusOwningGroup}
      consumeSuppressedPtyExit={() => false}
      captureEmptiedReaction={() => () => {}}
    />
  )
}

function RestoredWorkbench(): React.JSX.Element | null {
  useSplitWorktreeLifecycle()
  const restored = useSplitWorktreeState((state) => state.layout !== null)
  return restored ? <RetainedTerminal /> : null
}

beforeEach(() => {
  mounts = 0
  useAppStore.setState({
    repos: [{ ...TEST_REPO, executionHostId: 'local' }],
    worktreesByRepo: {
      [TEST_REPO.id]: [a, b].map(({ worktreeId }) =>
        makeWorktree({ id: worktreeId, repoId: TEST_REPO.id, path: `/${worktreeId}` })
      )
    },
    activeView: 'terminal',
    activeRepoId: TEST_REPO.id,
    activeWorktreeId: a.worktreeId,
    activeWorkspaceExecutionHostId: 'local',
    activeOrcaProfileId: createBrowserUuid(),
    workspaceSessionReady: true,
    hydrationSucceeded: true,
    tabsByWorktree: { [b.worktreeId]: [makeTab({ id: tabId, worktreeId: b.worktreeId })] },
    unifiedTabsByWorktree: {
      [b.worktreeId]: [makeUnifiedTab({ id: tabId, worktreeId: b.worktreeId, groupId })]
    },
    groupsByWorktree: {
      [b.worktreeId]: [
        makeTabGroup({
          id: groupId,
          worktreeId: b.worktreeId,
          activeTabId: tabId,
          tabOrder: [tabId]
        })
      ]
    },
    layoutByWorktree: { [b.worktreeId]: { type: 'leaf', groupId } },
    activeGroupIdByWorktree: { [b.worktreeId]: groupId },
    activeTabIdByWorktree: { [b.worktreeId]: tabId },
    terminalLayoutsByTabId: { [tabId]: layout },
    ptyIdsByTabId: {},
    everActivatedWorktreeIds: new Set([a.worktreeId, b.worktreeId]),
    refreshGitHubForWorktreeIfStale: vi.fn()
  })
  useSplitWorktreeState.setState({
    layout: planSplitLayout(null, a, b, 'right'),
    pending: false,
    ownershipUnconfirmed: false
  })
  publishWindowWorkspaceClaims({ status: 'ready', ownedRefs: [a, b], blockedRefs: [] })
  stopClaims = bindWindowWorkspaceClaimSession({
    prepare: async (refs) => ({
      status: 'accepted',
      commit: () =>
        publishWindowWorkspaceClaims({ status: 'ready', ownedRefs: refs, blockedRefs: [] }),
      rollback: async () => {}
    })
  })
})

afterEach(() => {
  cleanup()
  stopClaims()
  localStorage.removeItem(splitPersistenceKey())
  takeAllPendingManualTerminalWorktreeParks()
  useAppStore.setState(original, true)
  useSplitWorktreeState.setState(originalSplit, true)
  vi.restoreAllMocks()
})

it('settles pane restoration after a workspace switch while the PTY is still reconnecting', () => {
  act(() => {
    activateAndRevealWorkspace(b.worktreeId, { executionHostId: 'local', revealInSidebar: false })
  })
  const generation = useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation
  expect(generation).toBe(1)

  const view = render(<RetainedTerminal />)
  for (let click = 0; click < 5; click += 1) {
    fireEvent.pointerDown(view.getByRole('textbox'))
  }

  expect(mounts).toBe(1)
  expect(useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation).toBe(generation)
  expect(useAppStore.getState().expandedPaneByTabId[tabId]).toBe(true)
  expect(useAppStore.getState().canExpandPaneByTabId[tabId]).toBe(true)
  expect(useAppStore.getState().terminalLayoutsByTabId[tabId]).toEqual(layout)
})

it('restores the survivor once when closing the focused workspace split', async () => {
  render(<RetainedTerminal />)
  expect(mounts).toBe(1)

  await act(async () => closeSplitWorktree(a.worktreeId))

  expect(useSplitWorktreeState.getState().layout).toBeNull()
  expect(useAppStore.getState().activeWorktreeId).toBe(b.worktreeId)
  expect(useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation).toBe(1)
  expect(mounts).toBe(2)
  expect(useAppStore.getState().terminalLayoutsByTabId[tabId]).toEqual(layout)
})

it('does not restart the selected survivor when the other workspace pane closes', async () => {
  act(() => {
    activateAndRevealWorkspace(b.worktreeId, { executionHostId: 'local', revealInSidebar: false })
  })
  const generation = useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation
  expect(generation).toBe(1)

  await act(async () => closeSplitWorktree(a.worktreeId))
  render(<RetainedTerminal />)

  expect(useSplitWorktreeState.getState().layout).toBeNull()
  expect(useAppStore.getState().activeWorktreeId).toBe(b.worktreeId)
  expect(useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation).toBe(generation)
  expect(mounts).toBe(1)
})

it('restores a persisted split after restart without remounting its reconnecting terminal', async () => {
  const saved = planSplitLayout(null, a, b, 'right')
  saveSplitWorktreeLayout(saved, b)
  useSplitWorktreeState.setState({ layout: null })
  useAppStore.setState({ activeWorktreeId: b.worktreeId, workspaceSessionReady: false })
  render(<RestoredWorkbench />)
  expect(mounts).toBe(0)

  await act(async () => useAppStore.setState({ workspaceSessionReady: true }))

  expect(useSplitWorktreeState.getState().layout).toEqual(saved)
  expect(useSplitWorktreeState.getState().ownershipUnconfirmed).toBe(false)
  expect(useAppStore.getState().activeWorktreeId).toBe(b.worktreeId)
  expect(useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation ?? 0).toBe(0)
  expect(mounts).toBe(1)
  expect(useAppStore.getState().terminalLayoutsByTabId[tabId]).toEqual(layout)
})

it.each(['local', 'ssh:test-host', 'runtime:test-host'] as const)(
  'keeps an already selected %s folder workspace unchanged on focus',
  (executionHostId) => {
    const folder = makeFolderWorkspace({ executionHostId })
    const ref = { worktreeId: `folder:${folder.id}`, executionHostId }
    useAppStore.setState({
      activeWorktreeId: ref.worktreeId,
      activeWorkspaceExecutionHostId: executionHostId,
      folderWorkspaces: [folder]
    })
    useSplitWorktreeState.setState({ layout: planSplitLayout(null, a, ref, 'right') })
    const before = useAppStore.getState()

    expect(focusSplitWorkspace(ref)).toBe(true)
    expect(useAppStore.getState()).toBe(before)
  }
)

it.each([
  { activeView: 'terminal', activeWorkspaceExecutionHostId: 'ssh:other-host' },
  { activeView: 'settings', activeWorkspaceExecutionHostId: 'local' }
] as const)('still activates a different selection: %j', (selection) => {
  useAppStore.setState({ activeWorktreeId: b.worktreeId, ...selection })

  expect(focusSplitWorkspace(b)).toBe(true)
  expect(useAppStore.getState().activeView).toBe('terminal')
  expect(useAppStore.getState().activeWorkspaceExecutionHostId).toBe('local')
  expect(useAppStore.getState().tabsByWorktree[b.worktreeId][0].generation).toBe(1)
})

it('recognizes the resolved host when the current selection has no explicit host', () => {
  useAppStore.setState({ activeWorktreeId: b.worktreeId, activeWorkspaceExecutionHostId: null })
  const before = useAppStore.getState()

  expect(focusSplitWorkspace(b)).toBe(true)
  expect(useAppStore.getState()).toBe(before)
})
