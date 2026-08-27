import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { GitHistoryResult } from '../../../../shared/git-history'
import { GitHistoryPanel } from './source-control/sync/git-history-panel'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const timestamp = new Date(2026, 5, 15, 12).getTime()

function makeHistoryResult(): GitHistoryResult {
  return {
    items: [
      {
        id: '52ad492abcd',
        parentIds: [],
        subject: 'Fix tab overflow',
        message: 'Fix tab overflow',
        displayId: '52ad492',
        author: 'Taylor',
        timestamp,
        references: []
      }
    ],
    currentRef: {
      id: 'refs/heads/main',
      name: 'main',
      revision: '52ad492abcd',
      category: 'branches'
    },
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 50
  }
}

describe('GitHistoryPanel', () => {
  it.each([Number.NaN, Number.MAX_VALUE])(
    'renders commits with malformed timestamp %s without crashing',
    (malformedTimestamp) => {
      const result = makeHistoryResult()
      result.items[0].timestamp = malformedTimestamp

      const markup = renderToStaticMarkup(
        <GitHistoryPanel
          state={{ status: 'ready', result }}
          collapsed={false}
          scope="branch"
          onToggle={vi.fn()}
          onToggleScope={vi.fn()}
          onRefresh={vi.fn()}
          onOpenCommit={vi.fn()}
        />
      )

      expect(markup).toContain('Fix tab overflow')
    }
  )

  // The dense row is subject-only; author and date now surface on expand, so the
  // collapsed row shows the subject and short id (the short id via aria-label).
  it('renders the commit subject row', () => {
    const markup = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result: makeHistoryResult() }}
        collapsed={false}
        scope="branch"
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
        onOpenCommit={vi.fn()}
      />
    )

    expect(markup).toContain('Fix tab overflow')
    expect(markup).toContain('52ad492')
  })

  it('does not add native title tooltips alongside managed history tooltips', () => {
    const result = makeHistoryResult()
    result.items[0].references = [
      { id: 'refs/heads/main', name: 'main', category: 'branches' },
      { id: 'refs/heads/feature', name: 'feature', category: 'branches' },
      { id: 'refs/tags/v1.0.0', name: 'v1.0.0', category: 'tags' }
    ]

    const markup = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result }}
        collapsed={false}
        scope="branch"
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
        onOpenCommit={vi.fn()}
      />
    )

    expect(markup).not.toContain('title="Fix tab overflow"')
    expect(markup).not.toContain('title="main"')
    expect(markup).not.toContain('title="feature"')
    expect(markup).not.toContain('title="v1.0.0"')
    expect(markup).not.toMatch(/\stitle=/)
  })

  it('reflects the graph scope on the all-branches toggle', () => {
    const branchScoped = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result: makeHistoryResult() }}
        collapsed={false}
        scope="branch"
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
    const allScoped = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result: makeHistoryResult() }}
        collapsed={false}
        scope="all"
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(branchScoped).toContain('aria-pressed="false"')
    expect(allScoped).toContain('aria-pressed="true"')
  })

  // The all-branches scope routinely opens more lanes than the graph draws; folding the extra
  // lanes onto the last column is what keeps those rows from rendering as a bare line of text.
  it('keeps the commit node inside the drawing box when the graph outgrows the lane cap', () => {
    const result = makeHistoryResult()
    result.currentRef = undefined
    result.items = Array.from({ length: 13 }, (_, index) => ({
      id: `head-${index}`,
      parentIds: [`root-${index}`],
      subject: `branch ${index}`,
      message: `branch ${index}`,
      displayId: `head-${index}`,
      references: []
    }))

    const markup = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result }}
        collapsed={false}
        scope="all"
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    // Header icons are svgs too; the graph is the one with the row drawing box.
    const svgs = (markup.match(/<svg[^>]*>.*?<\/svg>/gs) ?? []).filter((svg) =>
      svg.includes('shrink-0 overflow-hidden')
    )
    expect(svgs).toHaveLength(13)
    for (const svg of svgs) {
      const width = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1])
      const centers = [...svg.matchAll(/cx="(-?\d+(?:\.\d+)?)"/g)].map((match) => Number(match[1]))
      expect(centers.length).toBeGreaterThan(0)
      expect(Math.max(...centers)).toBeLessThanOrEqual(width)
    }
    // Lane 12 folds onto the last drawn lane instead of sitting at x=143, outside a 106px box.
    expect(svgs.at(-1)).toContain('cx="99"')
  })

  it('offers a load-more control only when another page is available', () => {
    const result = makeHistoryResult()
    result.hasMore = true
    const onLoadMore = vi.fn()

    const withMore = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result }}
        collapsed={false}
        scope="all"
        canLoadMore
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onLoadMore={onLoadMore}
        onRefresh={vi.fn()}
      />
    )
    const withoutMore = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result: makeHistoryResult() }}
        collapsed={false}
        scope="all"
        canLoadMore={false}
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onLoadMore={onLoadMore}
        onRefresh={vi.fn()}
      />
    )

    expect(withMore).toContain('Load more commits')
    expect(withoutMore).not.toContain('Load more commits')
  })

  it('marks a branch ref that another workspace has checked out', () => {
    const result = makeHistoryResult()
    result.items[0].references = [
      { id: 'refs/heads/feature', name: 'feature', category: 'branches' }
    ]

    const markup = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result }}
        collapsed={false}
        scope="all"
        worktreesByBranch={
          new Map([['feature', { worktreeId: 'repo::/b', displayName: 'Feature work' }]])
        }
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(markup).toContain('git-history-ref-worktree')
    expect(markup).toContain('Feature work')
  })

  // A restored height has to survive the viewport clamp, which used to cap the panel at 33vh and
  // silently swallow the drag.
  it('renders a restored panel height', () => {
    const markup = renderToStaticMarkup(
      <GitHistoryPanel
        state={{ status: 'ready', result: makeHistoryResult() }}
        collapsed={false}
        scope="branch"
        height={900}
        onToggle={vi.fn()}
        onToggleScope={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(markup).toContain('min(900px, 85vh)')
  })
})
