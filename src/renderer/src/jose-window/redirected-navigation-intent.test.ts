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

vi.mock('@/components/sidebar/sleep-worktree-flow', () => ({ runSleepWorktree: vi.fn() }))

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
