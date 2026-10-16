// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceManagerWorktreeTarget } from './resource-manager-worktree-target'
import type { UnifiedSessionRow } from './resource-usage-merge-types'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn(),
  worktrees: [] as ResourceManagerWorktreeTarget[]
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace,
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: vi.fn() }))
vi.mock('../../store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('../../store/selectors', () => ({ getAllWorktreesFromState: () => mocks.worktrees }))
vi.mock('../sidebar/delete-worktree-flow', () => ({ runWorktreeDelete: vi.fn() }))

import { useResourceUsageActions } from './use-resource-usage-actions'
import { SessionRow } from './resource-usage-session-rows'

function renderActions(overrides: Partial<Parameters<typeof useResourceUsageActions>[0]> = {}) {
  return renderHook(() =>
    useResourceUsageActions({
      setCollapsedRepos: vi.fn(),
      setCollapsedWorktrees: vi.fn(),
      tabsByWorktree: {},
      setOpen: vi.fn(),
      setActiveView: vi.fn(),
      openModal: vi.fn(),
      openSpacePage: vi.fn(),
      refreshSessions: vi.fn(async () => {}),
      removeSession: vi.fn(),
      removeSessions: vi.fn(),
      sessions: [],
      resourceSessionBindings: {
        tabsByWorktree: {},
        ptyIdsByTabId: {},
        workspaceSessionReady: true
      },
      workspaceSessionReady: true,
      killConfirm: null,
      setKillConfirm: vi.fn(),
      setKilling: vi.fn(),
      mountedRef: { current: true },
      cancelPopoverBodyFocusFrame: vi.fn(),
      popoverBodyRef: { current: null },
      popoverBodyFocusFrameRef: { current: null },
      ...overrides
    })
  ).result.current
}

beforeEach(() => {
  mocks.activateAndRevealWorkspace.mockReset()
  mocks.activateAndRevealWorktree.mockReset()
  mocks.worktrees = [{ id: 'repo::/notes', hostId: 'ssh:box' }]
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Resource Manager row navigation', () => {
  it('activates a folder workspace row through the workspace dispatcher', () => {
    renderActions().navigateToWorktree('folder:notes')

    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith('folder:notes')
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('still routes worktree rows through the host-resolved activator', () => {
    renderActions().navigateToWorktree('repo::/notes')

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('repo::/notes', {
      executionHostId: 'ssh:box'
    })
    expect(mocks.activateAndRevealWorkspace).not.toHaveBeenCalled()
  })
})

describe('Resource Manager row kill', () => {
  const session: UnifiedSessionRow = {
    sessionId: 'bound-pty',
    paneKey: null,
    pid: 42,
    label: 'zsh',
    bound: true,
    agentOwnership: 'present',
    tabId: 'tab-1',
    cpu: null,
    memory: null,
    hasLocalSamples: false
  }

  function setup(row = session) {
    vi.useFakeTimers()
    const events: string[] = []
    let resolveKill = (): void => {}
    let rejectKill = (): void => {}
    const kill = vi.fn(() => {
      events.push('kill')
      return new Promise<void>((resolve, reject) => {
        resolveKill = resolve
        rejectKill = () => reject(new Error('already exited'))
      })
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { pty: { kill } } })
    const setKillConfirm = vi.fn()
    const popoverBody = document.createElement('div')
    popoverBody.tabIndex = -1
    document.body.appendChild(popoverBody)
    const actions = renderActions({
      setKillConfirm,
      removeSession: () => {
        events.push('remove')
        view.rerender(null)
      },
      refreshSessions: async () => {
        events.push('refresh')
      },
      popoverBodyRef: { current: popoverBody }
    })
    const view = render(
      <SessionRow
        session={row}
        worktreeId="folder:notes"
        onNavigate={vi.fn()}
        onKill={actions.handleKillSession}
      />,
      { container: popoverBody }
    )
    return {
      ...view,
      actions,
      events,
      kill,
      setKillConfirm,
      popoverBody,
      resolveKill: () => resolveKill(),
      rejectKill: () => rejectKill()
    }
  }

  it.each([
    { name: 'bound', row: session },
    { name: 'unbound agent-owned', row: { ...session, bound: false, tabId: null } },
    {
      name: 'unproven owner',
      row: { ...session, bound: false, tabId: null, agentOwnership: 'unknown' as const }
    },
    {
      name: 'unowned',
      row: { ...session, bound: false, tabId: null, agentOwnership: 'absent' as const }
    }
  ])('kills a $name row from its X without opening confirmation', ({ row }) => {
    const view = setup(row)
    const button = view.getByRole('button', { name: 'Kill session bound-pty' })
    button.focus()
    fireEvent.click(button)
    act(() => vi.advanceTimersToNextFrame())

    expect({
      calls: view.kill.mock.calls,
      confirmations: view.setKillConfirm.mock.calls,
      rowRemoved: view.queryByRole('button', { name: 'Kill session bound-pty' }) === null,
      focusInList: document.activeElement === view.popoverBody,
      events: view.events
    }).toEqual({
      calls: [['bound-pty']],
      confirmations: [],
      rowRemoved: true,
      focusInList: true,
      events: ['remove', 'kill']
    })
  })

  it.each(['resolved', 'rejected'])('refreshes only after the kill has %s', async (outcome) => {
    const view = setup()
    fireEvent.click(view.getByRole('button', { name: 'Kill session bound-pty' }))
    const beforeSettlement = [...view.events]
    await act(async () => {
      if (outcome === 'resolved') {
        view.resolveKill()
      } else {
        view.rejectKill()
      }
    })

    expect({ beforeSettlement, afterSettlement: view.events }).toEqual({
      beforeSettlement: ['remove', 'kill'],
      afterSettlement: ['remove', 'kill', 'refresh']
    })
  })

  it('refuses read-only sessions even if the action is called directly', () => {
    const row = { ...session, readOnly: true as const }
    const view = setup(row)
    view.actions.handleKillSession(row)

    expect({
      events: view.events,
      confirmations: view.setKillConfirm.mock.calls,
      button: view.queryByRole('button', { name: 'Kill session bound-pty' })
    }).toEqual({ events: [], confirmations: [], button: null })
  })
})
