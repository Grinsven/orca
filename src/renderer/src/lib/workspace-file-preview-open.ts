import { reloadBrowserPageWebview } from '@/components/browser-pane/navigate/browser-reload-action'
import { webviewRegistry } from '@/components/browser-pane/host-guest/webview-registry'
import { activateBrowserWorkspaceTab } from '@/lib/browser-workspace-tab-activation'
import { getWorkspaceFilePreviewPlan, openDocPreviewTab } from '@/lib/file-preview'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { browserPageDocLocationsEqual } from '../../../shared/browser-page-doc-location'
import type { BrowserPage } from '../../../shared/browser-workspace-types'
import type { ExecutionHostId } from '../../../shared/execution-host'

export type WorkspaceFilePreviewOpenResult =
  | { status: 'opened'; reused: boolean }
  | { status: 'unsupported'; message: string }

type PreviewPageMatch = { workspaceId: string; pageId: string }

/** Searches every page, not the workspace mirror, which only reflects the active page. */
function findWorktreeBrowserPage(
  state: AppState,
  worktreeId: string,
  matches: (page: BrowserPage) => boolean
): PreviewPageMatch | null {
  for (const tab of state.browserTabsByWorktree[worktreeId] ?? []) {
    const page = (state.browserPagesByWorkspace[tab.id] ?? []).find(matches)
    if (page) {
      return { workspaceId: tab.id, pageId: page.id }
    }
  }
  return null
}

// Why: an in-page anchor the reader followed is still the same document.
function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
  } catch {
    return url
  }
}

function showPreviewPage(worktreeId: string, match: PreviewPageMatch): void {
  if (!activateBrowserWorkspaceTab({ worktreeId, ...match })) {
    const state = useAppStore.getState()
    state.setActiveBrowserTab(match.workspaceId)
    state.setActiveBrowserPage(match.workspaceId, match.pageId)
  }
}

// Why no fallback: a page with no live guest loads the file fresh when it is next shown.
function reloadPreviewPage(pageId: string): void {
  const webview = webviewRegistry.get(pageId)
  if (webview) {
    reloadBrowserPageWebview(webview, { ignoreCache: true })
  }
}

/**
 * Renders an HTML file the way a Cmd/Ctrl-click on its terminal path does, re-using and reloading
 * a tab that already shows it. `focus: false` opens it without changing what is on screen.
 */
export function openWorkspaceFilePreview(params: {
  /** Absolute path on the worktree's execution host. */
  filePath: string
  worktreeId: string
  focus: boolean
  executionHostId?: ExecutionHostId
}): WorkspaceFilePreviewOpenResult {
  const { filePath, worktreeId, focus, executionHostId } = params
  const plan = getWorkspaceFilePreviewPlan(useAppStore.getState(), worktreeId, filePath)
  if (plan.status === 'unsupported') {
    return { status: 'unsupported', message: plan.message }
  }
  if (focus) {
    // Why: mirrors the terminal Cmd-click; the preview is the surface, so no shell is seeded.
    activateAndRevealWorktree(worktreeId, { providesInitialSurface: true, executionHostId })
  }
  const state = useAppStore.getState()
  const docLocation = { kind: 'workspace-doc' as const, worktreeId, filePath }
  const existing =
    plan.status === 'browser-tab'
      ? findWorktreeBrowserPage(
          state,
          worktreeId,
          (page) => !page.docLocation && withoutFragment(page.url) === withoutFragment(plan.url)
        )
      : findWorktreeBrowserPage(state, worktreeId, (page) =>
          browserPageDocLocationsEqual(page.docLocation ?? null, docLocation)
        )
  if (existing) {
    if (focus) {
      showPreviewPage(worktreeId, existing)
    }
    reloadPreviewPage(existing.pageId)
    return { status: 'opened', reused: true }
  }
  if (plan.status === 'doc-preview') {
    openDocPreviewTab(state, { filePath, worktreeId, activate: focus })
  } else {
    state.createBrowserTab(worktreeId, plan.url, { title: plan.title, activate: focus })
  }
  return { status: 'opened', reused: false }
}
