import { test, expect } from './helpers/orca-app'
import { openChecks } from './helpers/source-control-ai-generation'
import {
  FIXTURE_COMMENTS,
  seedPRCommentsSidebarFixture
} from './helpers/pr-comments-sidebar-fixture'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('comment blocks retain spacing across raw HTML and nested details', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const { worktreeId } = await seedPRCommentsSidebarFixture(orcaPage)
  const comment = {
    ...FIXTURE_COMMENTS[0],
    body: [
      'First paragraph.',
      '<details open><summary>Details title</summary><p>Nested paragraph.</p></details>',
      '<div>Raw block.</div>',
      'Second paragraph.',
      '## Section heading',
      '```text\ncode block\n```'
    ].join('\n\n')
  }
  await orcaPage.evaluate((seed) => {
    window.__store!.setState({ fetchPRComments: async () => [seed] })
  }, comment)
  await openChecks(orcaPage, worktreeId)
  const card = orcaPage.getByTestId('pr-comment-group').filter({ hasText: 'First paragraph.' })
  await card.getByText('Second paragraph.', { exact: true }).waitFor({ state: 'visible' })
  const spacing = await card.evaluate((element) => {
    const paragraph = Array.from(element.querySelectorAll('.comment-md-p')).find(
      (node) => node.textContent === 'First paragraph.'
    )
    if (!paragraph?.parentElement) {
      throw new Error('Rendered comment paragraph is missing')
    }
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return Array.from(paragraph.parentElement.children).map((child) => ({
      text: child.textContent?.trim(),
      topRem: Number.parseFloat(getComputedStyle(child).marginTop) / rem,
      bottomRem: Number.parseFloat(getComputedStyle(child).marginBottom) / rem
    }))
  })

  expect(spacing).toEqual([
    { text: 'First paragraph.', topRem: 0, bottomRem: 0 },
    { text: 'Details titleNested paragraph.', topRem: 0.5, bottomRem: 0.5 },
    { text: 'Raw block.', topRem: 0.5, bottomRem: 0 },
    { text: 'Second paragraph.', topRem: 0.5, bottomRem: 0 },
    { text: 'Section heading', topRem: 1, bottomRem: 0.25 },
    { text: 'code block', topRem: 0.5, bottomRem: 0.25 }
  ])
})
