// Adapted from T3 Code (github.com/pingdotgg/t3code, MIT, Copyright (c) 2026 T3 Tools Inc.)
import type { CodeViewDiffItem } from '@pierre/diffs'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { useCallback, type ReactNode, type Ref } from 'react'
import { CHANGES_CODE_VIEW_CSS } from './changes-code-view-css'
import {
  CHANGES_DIFF_HIGHLIGHTER,
  ChangesDiffWorkerPoolProvider,
  type ChangesDiffThemeName
} from './changes-diff-worker-pool'

export type ChangesCodeViewHandle = CodeViewHandle<undefined, undefined>

export function ChangesCodeView({
  items,
  themeName,
  layout,
  wordWrap,
  codeFontFamily,
  viewerRef,
  onScroll,
  renderHeaderPrefix,
  renderHeaderMetadata
}: {
  items: readonly CodeViewDiffItem<undefined>[]
  themeName: ChangesDiffThemeName
  layout: 'stacked' | 'split'
  wordWrap: boolean
  codeFontFamily: string
  viewerRef: Ref<ChangesCodeViewHandle>
  onScroll: (scrollTop: number) => void
  renderHeaderPrefix: (item: CodeViewDiffItem<undefined>) => ReactNode
  renderHeaderMetadata: (item: CodeViewDiffItem<undefined>) => ReactNode
}): React.JSX.Element {
  // Why: Pierre's shadow roots inherit custom properties, so the editor font reaches the code rows.
  // The mono stack follows it, or a font that is not installed falls back to a serif face.
  const setFontHost = useCallback(
    (node: HTMLDivElement | null) =>
      node?.style.setProperty('--changes-code-font', `${codeFontFamily}, var(--font-mono)`),
    [codeFontFamily]
  )
  return (
    <div ref={setFontHost} className="h-full min-h-0">
      <ChangesDiffWorkerPoolProvider themeName={themeName}>
        <CodeView<undefined>
          ref={viewerRef}
          items={items}
          className="scrollbar-editor h-full min-h-0 overflow-auto bg-editor-surface outline-none"
          onScroll={onScroll}
          renderHeaderPrefix={(item) => (item.type === 'diff' ? renderHeaderPrefix(item) : null)}
          renderHeaderMetadata={(item) =>
            item.type === 'diff' ? renderHeaderMetadata(item) : null
          }
          options={{
            diffStyle: layout === 'split' ? 'split' : 'unified',
            // Same as T3: word-level highlighting costs layout time on every scroll for little gain.
            lineDiffType: 'none',
            overflow: wordWrap ? 'wrap' : 'scroll',
            theme: themeName,
            themeType: themeName === 'pierre-dark' ? 'dark' : 'light',
            preferredHighlighter: CHANGES_DIFF_HIGHLIGHTER,
            stickyHeaders: true,
            hunkSeparators: 'line-info-basic',
            unsafeCSS: CHANGES_CODE_VIEW_CSS,
            itemMetrics: {
              diffHeaderHeight: 32,
              hunkSeparatorHeight: 24,
              // Why: Pierre falls back to this gap in some expanded-file paths; zero keeps the first header flush.
              spacing: 0,
              paddingTop: 0,
              // Why: Pierre always paints 8px under a file's last line, so the virtual height must count it.
              paddingBottom: 8
            },
            layout: { paddingTop: 0, paddingBottom: 0, gap: 0 }
          }}
        />
      </ChangesDiffWorkerPoolProvider>
    </div>
  )
}
