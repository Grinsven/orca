// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { makeTab } from '@/store/slices/store-session-test-harness'
import { getDefaultSettings } from '../../../shared/constants'
import { useManualTerminalWorktreeParking } from '@/components/terminal-pane/use-manual-terminal-worktree-parking'
import {
  clearTerminalProviderSnapshotCapabilities,
  synchronizeTerminalProviderSnapshotCapabilities
} from '@/components/terminal/terminal-provider-snapshot-capability'
import {
  requestManualTerminalWorktreePark,
  takeAllPendingManualTerminalWorktreeParks
} from '@/lib/manual-terminal-worktree-parking'
import { bindWindowWorkspaceClaimSession } from '@/jose-window/window-workspace-claims'
import { closeSplitWorktree } from './split-worktree-actions'
import { planSplitLayout, useSplitWorktreeState } from './split-worktree-state'

const original = useAppStore.getState()
const originalSplit = useSplitWorktreeState.getState()
const removed = { worktreeId: 'parking-removed', executionHostId: 'local' as const }
const survivor = { worktreeId: 'parking-survivor', executionHostId: 'local' as const }
const tabId = 'parking-tab'
const ptyId = `${removed.worktreeId}@@session-1`
const leafId = '00000000-0000-4000-8000-000000000001'
let stopClaims = (): void => {}

beforeEach(async () => {
  vi.spyOn(toast, 'warning')
  useAppStore.setState({
    activeView: 'terminal',
    activeWorktreeId: survivor.worktreeId,
    activeWorkspaceExecutionHostId: 'local',
    settings: getDefaultSettings('/test-home'),
    tabsByWorktree: {
      [removed.worktreeId]: [makeTab({ id: tabId, worktreeId: removed.worktreeId, ptyId })]
    },
    ptyIdsByTabId: { [tabId]: [ptyId] },
    terminalLayoutsByTabId: {
      [tabId]: {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leafId]: ptyId }
      }
    }
  })
  useSplitWorktreeState.setState({
    layout: planSplitLayout(null, removed, survivor, 'right'),
    pending: false,
    ownershipUnconfirmed: false
  })
  stopClaims = bindWindowWorkspaceClaimSession({
    prepare: async () => ({ status: 'accepted', commit: () => {}, rollback: async () => {} })
  })
  await synchronizeTerminalProviderSnapshotCapabilities([ptyId], async (ids) =>
    ids.map((id) => ({ id, authoritative: true }))
  )
})

afterEach(() => {
  cleanup()
  stopClaims()
  takeAllPendingManualTerminalWorktreeParks()
  clearTerminalProviderSnapshotCapabilities()
  useAppStore.setState(original, true)
  useSplitWorktreeState.setState(originalSplit, true)
  vi.restoreAllMocks()
})

const ineligible = [
  {
    reason: 'empty workspace',
    prepare: () => useAppStore.setState({ tabsByWorktree: {} })
  },
  {
    reason: 'reconnecting terminal',
    prepare: () =>
      useAppStore.setState({
        tabsByWorktree: {
          [removed.worktreeId]: [makeTab({ id: tabId, worktreeId: removed.worktreeId })]
        },
        ptyIdsByTabId: {}
      })
  },
  {
    reason: 'pending startup',
    prepare: () => useAppStore.getState().queueTabStartupCommand(tabId, { command: 'echo pending' })
  },
  {
    reason: 'unconfirmed snapshot capability',
    prepare: () => clearTerminalProviderSnapshotCapabilities()
  },
  {
    reason: 'missing watcher coverage',
    prepare: () => useAppStore.setState({ terminalLayoutsByTabId: {} })
  },
  {
    reason: 'disabled parking',
    prepare: () =>
      useAppStore.setState({
        settings: { ...getDefaultSettings('/test-home'), terminalHiddenViewParking: false }
      })
  }
]

it.each(ineligible)(
  'closes the split quietly for $reason without parking it',
  async ({ prepare }) => {
    prepare()
    const tabsBefore = useAppStore.getState().tabsByWorktree
    const ptysBefore = useAppStore.getState().ptyIdsByTabId
    const { result } = renderHook(() =>
      useManualTerminalWorktreeParking({
        activeView: 'terminal',
        renderedActiveWorktreeId: survivor.worktreeId
      })
    )

    await act(async () => closeSplitWorktree(removed.worktreeId))

    expect(useSplitWorktreeState.getState().layout).toBeNull()
    expect(useAppStore.getState().activeWorktreeId).toBe(survivor.worktreeId)
    expect(result.current.has(removed.worktreeId)).toBe(false)
    expect(useAppStore.getState().tabsByWorktree).toBe(tabsBefore)
    expect(useAppStore.getState().ptyIdsByTabId).toBe(ptysBefore)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(takeAllPendingManualTerminalWorktreeParks()).toEqual([])
  }
)

it('still parks a safely restorable terminal after closing its split', async () => {
  const { result } = renderHook(() =>
    useManualTerminalWorktreeParking({
      activeView: 'terminal',
      renderedActiveWorktreeId: survivor.worktreeId
    })
  )

  await act(async () => closeSplitWorktree(removed.worktreeId))

  expect(result.current.has(removed.worktreeId)).toBe(true)
  expect(useAppStore.getState().ptyIdsByTabId[tabId]).toEqual([ptyId])
  expect(toast.warning).not.toHaveBeenCalled()
})

it('still warns when an explicit manual park request is refused', () => {
  clearTerminalProviderSnapshotCapabilities()
  const { result } = renderHook(() =>
    useManualTerminalWorktreeParking({
      activeView: 'terminal',
      renderedActiveWorktreeId: survivor.worktreeId
    })
  )

  act(() => requestManualTerminalWorktreePark(removed.worktreeId))

  expect(result.current.has(removed.worktreeId)).toBe(false)
  expect(toast.warning).toHaveBeenCalledOnce()
})

it.each([
  {
    ref: { worktreeId: 'folder:parking-folder', executionHostId: 'local' as const },
    pty: 'folder:parking-folder@@session-1',
    sshEnabled: true,
    parked: true
  },
  {
    ref: { worktreeId: 'ssh-workspace', executionHostId: 'ssh:ssh-1' as const },
    pty: 'ssh:ssh-1@@pty-1',
    sshEnabled: true,
    parked: true
  },
  {
    ref: { worktreeId: 'ssh-workspace', executionHostId: 'ssh:ssh-1' as const },
    pty: 'ssh:ssh-1@@pty-1',
    sshEnabled: false,
    parked: false
  }
])('preserves folder and SSH park policy: %j', async ({ ref, pty, sshEnabled, parked }) => {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/test-home'), terminalSshViewParking: sshEnabled },
    tabsByWorktree: {
      [ref.worktreeId]: [makeTab({ id: tabId, worktreeId: ref.worktreeId, ptyId: pty })]
    },
    ptyIdsByTabId: { [tabId]: [pty] },
    terminalLayoutsByTabId: {
      [tabId]: {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leafId]: pty }
      }
    }
  })
  await synchronizeTerminalProviderSnapshotCapabilities([pty], async (ids) =>
    ids.map((id) => ({ id, authoritative: true }))
  )
  useSplitWorktreeState.setState({ layout: planSplitLayout(null, ref, survivor, 'right') })
  const { result } = renderHook(() =>
    useManualTerminalWorktreeParking({
      activeView: 'terminal',
      renderedActiveWorktreeId: survivor.worktreeId
    })
  )

  await act(async () => closeSplitWorktree(ref.worktreeId))

  expect(result.current.has(ref.worktreeId)).toBe(parked)
  expect(useAppStore.getState().ptyIdsByTabId[tabId]).toEqual([pty])
  expect(toast.warning).not.toHaveBeenCalled()
})
