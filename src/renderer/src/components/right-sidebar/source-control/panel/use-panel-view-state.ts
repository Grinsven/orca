import { useCallback, useMemo, useRef, useState } from 'react'
import { resolveSourceControlGroupOrder } from '../listing/section-order'
import { getNextSourceControlViewMode } from './header-toolbar'
import { normalizeSourceControlViewMode } from '../commit/commit-drafts'
import {
  normalizeGitHistoryPanelHeight,
  normalizeGitHistoryScope
} from '../../../../../../shared/git-history'
import type { SourceControlStoreActions } from '../listing/use-store-actions'
import type { SourceControlWorktreeContext } from '../listing/use-worktree-context'

const DEFAULT_COLLAPSED_SECTIONS = ['history'] as const

// Why the flag: 'history' collapses by default, but once the user opens it that has to survive a
// worktree switch, which resets every other section.
function createDefaultCollapsedSections(historyExpanded: boolean): Set<string> {
  const sections = new Set<string>(DEFAULT_COLLAPSED_SECTIONS)
  if (historyExpanded) {
    sections.delete('history')
  }
  return sections
}

/**
 * Local presentation state for the Source Control panel: filter, collapsed sections/directories,
 * list-vs-tree mode and the base-ref dialog, plus the per-worktree reset that keeps a worktree
 * switch from inheriting the previous worktree's view.
 */
export function useSourceControlPanelViewState({
  activeWorktreeId,
  settings,
  updateSettings
}: {
  activeWorktreeId: string | null
  settings: SourceControlWorktreeContext['settings']
  updateSettings: SourceControlStoreActions['updateSettings']
}) {
  const sourceControlRef = useRef<HTMLDivElement | null>(null)
  // Why: virtualize against the panel's shared scroller; use state (not a ref) so lists re-render and start observing once the element attaches.
  const [fileListScrollElement, setFileListScrollElement] = useState<HTMLDivElement | null>(null)
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const [filterExpanded, setFilterExpanded] = useState(false)
  const gitHistoryExpandedSetting = settings?.sourceControlHistoryExpanded ?? false
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    createDefaultCollapsedSections(gitHistoryExpandedSetting)
  )
  const persistedSourceControlViewMode = normalizeSourceControlViewMode(
    settings?.sourceControlViewMode
  )
  const sourceControlViewMode = persistedSourceControlViewMode
  const sourceControlGroupOrder = resolveSourceControlGroupOrder(settings?.sourceControlGroupOrder)
  const gitHistoryScope = normalizeGitHistoryScope(settings?.sourceControlHistoryScope)
  const [collapsedTreeDirs, setCollapsedTreeDirs] = useState<Set<string>>(new Set())
  const [baseRefDialogOpen, setBaseRefDialogOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const isGitHistoryExpanded = !collapsedSections.has('history')

  const handleToggleSourceControlViewMode = useCallback(() => {
    if (!settings) {
      return
    }
    updateSettings({
      sourceControlViewMode: getNextSourceControlViewMode(sourceControlViewMode)
    })
  }, [settings, sourceControlViewMode, updateSettings])

  const handleToggleGitHistoryScope = useCallback(() => {
    if (!settings) {
      return
    }
    updateSettings({ sourceControlHistoryScope: gitHistoryScope === 'all' ? 'branch' : 'all' })
  }, [gitHistoryScope, settings, updateSettings])

  // Why: reset during render instead of key-remounting on switch (which caused a Windows IPC storm).
  const [viewStateWorktreeId, setViewStateWorktreeId] = useState(activeWorktreeId)
  if (viewStateWorktreeId !== activeWorktreeId) {
    setViewStateWorktreeId(activeWorktreeId)
    setFilterExpanded(false)
    setCollapsedSections(createDefaultCollapsedSections(gitHistoryExpandedSetting))
    setCollapsedTreeDirs(new Set())
    setBaseRefDialogOpen(false)
    // Why: don't reset defaultBaseRef here — it's repo-scoped (resolved on activeRepo change); resetting would clobber non-main defaults.
    setFilterQuery('')
    // Why: don't reset commit-in-flight state — it's per-worktree; resetting would re-enable Commit for an incoming worktree mid-commit.
  }

  const toggleSection = useCallback(
    (section: string) => {
      setCollapsedSections((prev) => {
        const next = new Set(prev)
        if (next.has(section)) {
          next.delete(section)
        } else {
          next.add(section)
        }
        // Why persist only 'history': the other sections are per-worktree view state.
        if (section === 'history' && settings) {
          updateSettings({ sourceControlHistoryExpanded: !next.has('history') })
        }
        return next
      })
    },
    [settings, updateSettings]
  )

  const gitHistoryPanelHeight = normalizeGitHistoryPanelHeight(
    settings?.sourceControlHistoryPanelHeight
  )

  const handleGitHistoryPanelHeightChange = useCallback(
    (height: number) => {
      if (!settings) {
        return
      }
      updateSettings({ sourceControlHistoryPanelHeight: height })
    },
    [settings, updateSettings]
  )

  const toggleTreeDir = useCallback((key: string) => {
    setCollapsedTreeDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return {
    baseRefDialogOpen,
    collapsedSections,
    collapsedTreeDirs,
    fileListScrollElement,
    filterExpanded,
    filterQuery,
    gitHistoryPanelHeight,
    gitHistoryScope,
    handleGitHistoryPanelHeightChange,
    handleToggleGitHistoryScope,
    handleToggleSourceControlViewMode,
    isGitHistoryExpanded,
    isMac,
    setBaseRefDialogOpen,
    setFileListScrollElement,
    setFilterExpanded,
    setFilterQuery,
    sourceControlGroupOrder,
    sourceControlRef,
    sourceControlViewMode,
    toggleSection,
    toggleTreeDir
  }
}

export type SourceControlPanelViewState = ReturnType<typeof useSourceControlPanelViewState>
