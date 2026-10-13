import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  JoseWindowNavigationIntent,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import { uiEventForIntent } from '../../../shared/jose-window-intent'
import { useAppStore } from '@/store'
import { registerMobileAndTerminalCloseIpcBridge } from '@/hooks/ipc-events/mobile-terminal-close-ipc-bridge'
import { registerTerminalUiRoutingIpcBridge } from '@/hooks/ipc-events/terminal-ui-routing-ipc-bridge'
import { setWindowOwnershipView } from './ownership-guard'
import { startWindowOwnership } from './window-ownership-session'
import type { Worktree } from '../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type * as TerminalCommandState from '@/hooks/ipc-events/terminal-command-state'

vi.mock('@/components/sidebar/sleep-worktree-flow', () => ({ runSleepWorktree: vi.fn() }))
vi.mock('@/hooks/ipc-events/terminal-command-state', async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalCommandState>()),
  focusTerminalInitiatedTab: vi.fn()
}))

const OWNED = 'repo::owned'
const initialAppStoreState = useAppStore.getState()
type Listener = (payload: Record<string, unknown>) => void

let listeners: Record<string, Listener>
let reveal: ReturnType<
  typeof vi.fn<
    (ref: JoseWindowWorktreeRef, intent?: JoseWindowNavigationIntent) => Promise<boolean>
  >
>

function capture(name: string) {
  return (callback: Listener) => {
    listeners[name] = callback
    return () => {}
  }
}

beforeEach(() => {
  listeners = {}
  vi.stubGlobal('window', {
    api: {
      ui: {
        onOpenFileFromMobile: capture('openFile'),
        onOpenDiffFromMobile: capture('openDiff'),
        onFocusTerminal: capture('focusTerminal'),
        onFocusEditorTab: capture('focusEditorTab'),
        onSplitTerminal: capture('split'),
        onRenameTerminal: capture('rename'),
        onCloseTerminal: capture('close'),
        onSleepWorktree: capture('sleep'),
        onResumeSleepingAgents: capture('resume')
      }
    }
  })
  registerMobileAndTerminalCloseIpcBridge([], vi.fn())
  registerTerminalUiRoutingIpcBridge([])
  reveal = vi.fn(async () => true)
  setWindowOwnershipView({
    link: { resolve: (worktreeId) => ({ worktreeId, executionHostId: 'local' }), reveal },
    ownedElsewhere: [{ worktreeId: OWNED, executionHostId: 'local' }]
  })
  useAppStore.setState({ activeWorktreeId: 'repo::here', setActiveWorktree: vi.fn() })
})

afterEach(() => {
  setWindowOwnershipView(null)
  useAppStore.setState(initialAppStoreState, true)
  vi.unstubAllGlobals()
})

const sentIntent = (): JoseWindowNavigationIntent | undefined => reveal.mock.calls[0]?.[1]

describe('a request for a worktree another window owns', () => {
  it('hands the file open to the owner and changes nothing here', () => {
    listeners.openFile?.({ worktreeId: OWNED, filePath: '/repo/owned/a.ts', relativePath: 'a.ts' })

    expect({ intent: sentIntent(), active: useAppStore.getState().activeWorktreeId }).toEqual({
      intent: { kind: 'file', filePath: '/repo/owned/a.ts', relativePath: 'a.ts' },
      active: 'repo::here'
    })
  })

  it('hands a preview open to the owner as a preview, without rendering it here', () => {
    listeners.openFile?.({
      worktreeId: OWNED,
      filePath: '/repo/owned/page.html',
      relativePath: 'page.html',
      preview: true
    })

    expect({ intent: sentIntent(), active: useAppStore.getState().activeWorktreeId }).toEqual({
      intent: {
        kind: 'file',
        filePath: '/repo/owned/page.html',
        relativePath: 'page.html',
        preview: true
      },
      active: 'repo::here'
    })
  })

  it('hands the diff open to the owner', () => {
    listeners.openDiff?.({
      worktreeId: OWNED,
      filePath: '/repo/owned/a.ts',
      relativePath: 'a.ts',
      staged: true
    })

    expect(sentIntent()).toEqual({
      kind: 'diff',
      filePath: '/repo/owned/a.ts',
      relativePath: 'a.ts',
      staged: true
    })
  })

  it('hands a non-active terminal pane focus to the owner', () => {
    listeners.focusTerminal?.({ worktreeId: OWNED, tabId: 'tab-2', leafId: 'leaf-3' })

    expect(sentIntent()).toMatchObject({ kind: 'terminal', tabId: 'tab-2', leafId: 'leaf-3' })
  })

  it('hands a non-active editor tab focus to the owner', () => {
    listeners.focusEditorTab?.({ worktreeId: OWNED, tabId: 'tab-4', userInitiated: true })

    expect(sentIntent()).toEqual({ kind: 'tab', tabId: 'tab-4', userInitiated: true })
  })
})

describe('uiEventForIntent', () => {
  it('keeps a preview open a preview on the owner', () => {
    expect(
      uiEventForIntent({
        worktreeId: OWNED,
        intent: { kind: 'file', filePath: '/p.html', relativePath: 'p.html', preview: true }
      })?.payload
    ).toMatchObject({ preview: true })
  })

  it('replays each request on the UI event it first arrived on', () => {
    const channels = (
      [
        { kind: 'file', filePath: '/f', relativePath: 'f' },
        { kind: 'diff', filePath: '/f', relativePath: 'f', staged: false },
        { kind: 'terminal', tabId: 't', leafId: 'l' },
        { kind: 'tab', tabId: 't' },
        { kind: 'workspace' }
      ] satisfies JoseWindowNavigationIntent[]
    ).map((intent) => uiEventForIntent({ worktreeId: OWNED, intent })?.channel ?? null)

    expect(channels).toEqual([
      'ui:openFileFromMobile',
      'ui:openDiffFromMobile',
      'ui:focusTerminal',
      'ui:focusEditorTab',
      null
    ])
  })
})

describe('a request replayed in the owning window', () => {
  const SHARED_ID = 'repo-1::a'
  const HUB: ExecutionHostId = 'runtime:hub'

  function row(hostId: ExecutionHostId): Worktree {
    return {
      id: SHARED_ID,
      repoId: 'repo-1',
      hostId,
      path: '/workspace/a',
      head: 'abc123',
      branch: 'refs/heads/a',
      isBare: false,
      isMainWorktree: false,
      displayName: 'a',
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

  it.each<[string, JoseWindowNavigationIntent]>([
    ['file', { kind: 'file', filePath: '/workspace/a/x.ts', relativePath: 'x.ts' }],
    ['diff', { kind: 'diff', filePath: '/workspace/a/x.ts', relativePath: 'x.ts', staged: false }],
    ['terminal pane', { kind: 'terminal', tabId: 'term-1', leafId: 'leaf-1' }],
    ['editor tab', { kind: 'tab', tabId: 'editor-1' }]
  ])('keeps the validated host when the same id exists on another host (%s)', (_, intent) => {
    setWindowOwnershipView(null)
    const setActiveWorktree = vi.fn()
    const noop = vi.fn()
    useAppStore.setState({
      repos: [{ id: 'repo-1', path: '/r', displayName: 'r', badgeColor: '#000', addedAt: 0 }],
      worktreesByRepo: { 'repo-1': [row(HUB), row('runtime:other-hub')] },
      unifiedTabsByWorktree: {
        [SHARED_ID]: [
          {
            id: 'editor-1',
            entityId: 'file-1',
            groupId: 'group-1',
            worktreeId: SHARED_ID,
            contentType: 'editor',
            label: 'x.ts',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      activeWorktreeId: SHARED_ID,
      activeWorkspaceExecutionHostId: HUB,
      setActiveWorktree,
      markWorktreeVisited: noop,
      openFile: noop,
      openDiff: noop,
      setActiveTab: noop,
      setActiveView: noop,
      setActiveTabType: noop,
      setActiveFile: noop,
      focusGroup: noop,
      activateTab: noop,
      revealWorktreeInSidebar: noop,
      recordWorktreeVisit: noop
    })
    const stop = startWindowOwnership(
      { kind: 'environment', environmentId: 'hub' },
      {
        store: useAppStore,
        subscribe: async (_target, callbacks) => {
          callbacks.onFrame({
            type: 'reveal',
            worktreeId: SHARED_ID,
            executionHostId: 'local',
            intent
          })
          return { unsubscribe: () => {} }
        },
        claim: async () => true,
        reveal: async () => true,
        raise: () => {},
        // Main re-sends the request on its UI event; the bridge listener receives that payload.
        applyIntent: (request) => {
          const event = uiEventForIntent(request)
          const name = {
            'ui:openFileFromMobile': 'openFile',
            'ui:openDiffFromMobile': 'openDiff',
            'ui:focusTerminal': 'focusTerminal',
            'ui:focusEditorTab': 'focusEditorTab'
          }[event?.channel ?? '']
          listeners[name ?? '']?.(event?.payload ?? {})
        },
        activateHere: () => true,
        isMissingMethod: () => false
      }
    )
    stop()

    expect(setActiveWorktree.mock.calls).toEqual([[SHARED_ID, HUB]])
  })
})
