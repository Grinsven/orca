import { useCallback, useMemo, useRef, useState } from 'react'
import type { CodeViewDiffItem } from '@pierre/diffs'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import { ChangesCodeView, type ChangesCodeViewHandle } from './changes-code-view'
import { ChangesFileCollapseButton, ChangesFileHeaderMeta } from './changes-file-header-parts'
import {
  buildChangesFileModels,
  sumChangesStats,
  type ChangesFileModel
} from './changes-file-models'
import { ChangesFileTreePane } from './changes-file-tree-pane'
import { ChangesViewHeader } from './changes-view-header'
import { findChangesHeaderTarget } from './changes-view-header-click'
import { useChangesFileContents } from './use-changes-file-contents'
import { useChangesScope } from './use-changes-scope'
import { useChangesViewPreferences } from './use-changes-view-preferences'

const NO_PATHS: ReadonlySet<string> = new Set()

export default function ChangesView({ file }: { file: OpenFile }): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const openFile = useAppStore((s) => s.openFile)
  const isDark = useDocumentDarkTheme()
  const scope = useChangesScope(file)
  const prefs = useChangesViewPreferences()
  const contents = useChangesFileContents({
    file,
    entries: scope.entries,
    branchCompare: scope.branchCompare,
    scopeKey: scope.scopeKey
  })
  const [collapsed, setCollapsed] = useState<{ scopeKey: string; paths: ReadonlySet<string> }>(
    () => ({ scopeKey: scope.scopeKey, paths: new Set() })
  )
  const collapsedPaths = collapsed.scopeKey === scope.scopeKey ? collapsed.paths : NO_PATHS
  const [activePath, setActivePath] = useState<string | null>(null)
  const viewerRef = useRef<ChangesCodeViewHandle>(null)

  const models = useMemo(
    () =>
      buildChangesFileModels({
        entries: scope.entries,
        states: contents.states,
        collapsedPaths,
        ignoreWhitespace: prefs.ignoreWhitespace
      }),
    [collapsedPaths, contents.states, prefs.ignoreWhitespace, scope.entries]
  )
  const items = useMemo(() => models.map((model) => model.item), [models])
  const modelByPath = useMemo(
    () => new Map<string, ChangesFileModel>(models.map((model) => [model.entry.path, model])),
    [models]
  )
  const totals = useMemo(() => sumChangesStats(models), [models])
  const loading = models.some((model) => model.notice?.kind === 'loading')
  const expandable = models.filter((model) => model.notice === null)
  const allCollapsed = expandable.length > 0 && expandable.every((model) => model.collapsed)

  const setCollapsedPaths = useCallback(
    (update: (paths: ReadonlySet<string>) => ReadonlySet<string>) => {
      setCollapsed((prev) => ({
        scopeKey: scope.scopeKey,
        paths: update(prev.scopeKey === scope.scopeKey ? prev.paths : NO_PATHS)
      }))
    },
    [scope.scopeKey]
  )
  const togglePath = useCallback(
    (path: string) =>
      setCollapsedPaths((paths) => {
        const next = new Set(paths)
        if (!next.delete(path)) {
          next.add(path)
        }
        return next
      }),
    [setCollapsedPaths]
  )
  const revealPath = useCallback(
    (path: string) => {
      setCollapsedPaths((paths) => {
        if (!paths.has(path)) {
          return paths
        }
        const next = new Set(paths)
        next.delete(path)
        return next
      })
      setActivePath(path)
      viewerRef.current?.scrollTo({ type: 'item', id: path, align: 'start' })
    },
    [setCollapsedPaths]
  )
  const openPath = useCallback(
    (path: string) => {
      if (modelByPath.get(path)?.entry.status === 'deleted') {
        return
      }
      openFile({
        filePath: joinPath(file.filePath, path),
        relativePath: path,
        worktreeId: file.worktreeId,
        runtimeEnvironmentId: file.runtimeEnvironmentId,
        language: detectLanguage(path),
        mode: 'edit'
      })
    },
    [file.filePath, file.runtimeEnvironmentId, file.worktreeId, modelByPath, openFile]
  )

  // Follow scroll in the tree: the file whose sticky header is at the top is the active one.
  const handleScroll = useCallback(
    (scrollTop: number) => {
      const viewer = viewerRef.current?.getInstance()
      if (!viewer || items.length === 0) {
        return
      }
      let low = 0
      let high = items.length - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if ((viewer.getTopForItem(items[mid].id) ?? Infinity) <= scrollTop + 1) {
          low = mid
        } else {
          high = mid - 1
        }
      }
      const path = items[low].id
      setActivePath((current) => (current === path ? current : path))
    },
    [items]
  )

  const renderHeaderPrefix = (item: CodeViewDiffItem<undefined>): React.ReactNode => {
    const model = modelByPath.get(item.id)
    if (!model) {
      return null
    }
    return (
      <ChangesFileCollapseButton
        path={model.entry.path}
        status={model.entry.status}
        collapsed={model.collapsed}
        onToggle={() => (model.notice === null ? togglePath(model.entry.path) : undefined)}
      />
    )
  }
  const renderHeaderMetadata = (item: CodeViewDiffItem<undefined>): React.ReactNode => {
    const model = modelByPath.get(item.id)
    if (!model) {
      return null
    }
    return (
      <ChangesFileHeaderMeta
        path={model.entry.path}
        stat={model.stat}
        notice={model.notice}
        onLoad={() => contents.loadFile(model.entry.path)}
      />
    )
  }

  const toolbar = {
    layout: prefs.layout,
    wordWrap: prefs.wordWrap,
    ignoreWhitespace: prefs.ignoreWhitespace,
    allCollapsed,
    fileTreeOpen: prefs.fileTreeOpen,
    refreshing: loading,
    onLayoutChange: prefs.setLayout,
    onWordWrapChange: prefs.setWordWrap,
    onIgnoreWhitespaceChange: prefs.setIgnoreWhitespace,
    onToggleAllCollapsed: () =>
      setCollapsedPaths(() =>
        allCollapsed ? new Set() : new Set(expandable.map((model) => model.entry.path))
      ),
    onFileTreeOpenChange: prefs.setFileTreeOpen,
    onRefresh: contents.refresh
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor-surface" data-changes-view={scope.scope}>
      <ChangesViewHeader
        scope={scope.scope}
        baseRef={scope.branchCompare?.baseRef ?? null}
        fileCount={models.length}
        totals={totals}
        totalsComplete={!loading}
        onScopeChange={scope.setScope}
        toolbar={toolbar}
      />
      {models.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {scope.scope === 'branch'
            ? 'No changes against the base branch.'
            : 'No uncommitted changes.'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ChangesFileTreePane
            worktreeId={file.worktreeId}
            worktreePath={file.filePath}
            entries={scope.entries}
            activePath={activePath}
            open={prefs.fileTreeOpen}
            onOpenChange={prefs.setFileTreeOpen}
            onNavigate={revealPath}
          />
          <div
            className="min-h-0 min-w-0 flex-1"
            onClickCapture={(event) => {
              const target = findChangesHeaderTarget(event.nativeEvent)
              if (target?.kind === 'title') {
                openPath(target.path)
              } else if (
                target?.kind === 'header' &&
                modelByPath.get(target.path)?.notice === null
              ) {
                togglePath(target.path)
              }
            }}
          >
            <ChangesCodeView
              items={items}
              themeName={isDark ? 'pierre-dark' : 'pierre-light'}
              layout={prefs.layout}
              wordWrap={prefs.wordWrap}
              codeFontFamily={resolveEditorFontFamily(settings)}
              viewerRef={viewerRef}
              onScroll={handleScroll}
              renderHeaderPrefix={renderHeaderPrefix}
              renderHeaderMetadata={renderHeaderMetadata}
            />
          </div>
        </div>
      )}
    </div>
  )
}
