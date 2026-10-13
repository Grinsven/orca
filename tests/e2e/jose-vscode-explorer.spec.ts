import { mkdir } from 'node:fs/promises'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Jose fork-local: Seti file icons and VS Code style git decorations in the Explorer tree.
const SCREENSHOT_DIR = process.env.JOSE_VSCODE_EXPLORER_SCREENSHOT_DIR

async function seedChanges(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = window.__store!.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === state.activeWorktreeId)
    if (!worktree) {
      throw new Error('no active worktree')
    }
    const separator = worktree.path.includes('\\') ? '\\' : '/'
    const write = (relativePath: string, content: string): Promise<void> =>
      window.api.fs.writeFile({
        filePath: [worktree.path, ...relativePath.split('/')].join(separator),
        content
      })
    await write('src/index.ts', 'export const hello = "changed"\n')
    await write('notes.md', '# Notes\n')
    await write('src/settings.json', '{}\n')
    state.setGitStatus(worktree.id, await window.api.git.status({ worktreePath: worktree.path }))
  })
}

function explorerRow(page: Page, name: string): Locator {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]', { hasText: name }) })
    .first()
}

/** The row's name color, and the color its decoration token resolves to right now. */
async function nameAndTokenColor(row: Locator, token: string): Promise<[string, string]> {
  return row.evaluate((element, tokenName) => {
    const name = element.querySelector<HTMLElement>('[data-file-explorer-row-name]')!
    const probe = document.createElement('span')
    probe.style.color = `var(${tokenName})`
    element.appendChild(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(name).color, expected]
  }, token)
}

async function expectDecoratedTree(page: Page): Promise<void> {
  const indexRow = explorerRow(page, 'index.ts')
  await expect(indexRow.locator("[data-seti-icon='typescript']")).toHaveCount(1)
  await expect(indexRow).toContainText(/M$/)
  const [indexColor, modifiedColor] = await nameAndTokenColor(indexRow, '--git-decoration-modified')
  expect(indexColor).toBe(modifiedColor)

  const notesRow = explorerRow(page, 'notes.md')
  await expect(notesRow.locator("[data-seti-icon='markdown']")).toHaveCount(1)
  await expect(notesRow).toContainText(/U$/)
  const [notesColor, untrackedColor] = await nameAndTokenColor(
    notesRow,
    '--git-decoration-untracked'
  )
  expect(notesColor).toBe(untrackedColor)

  await expect(explorerRow(page, 'settings.json').locator("[data-seti-icon='json']")).toHaveCount(1)
  const srcRow = explorerRow(page, 'src')
  await expect(srcRow.locator("[data-explorer-folder-icon='open']")).toHaveCount(1)
  await expect(srcRow).toContainText(/•$/)
  // The glyph comes from the bundled font, not a fallback box.
  const glyph = await indexRow.locator('[data-seti-icon]').evaluate((element) => {
    const before = getComputedStyle(element, '::before')
    return { content: before.content, font: before.fontFamily }
  })
  expect(glyph.content).not.toBe('none')
  expect(glyph.font).toContain('seti')
  expect(await page.evaluate(() => document.fonts.check('16px seti'))).toBe(true)
}

test('explorer shows Seti icons and VS Code git decorations', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await seedChanges(orcaPage)
  await openFileExplorer(orcaPage)
  await expect(explorerRow(orcaPage, 'src')).toBeVisible({ timeout: 10_000 })
  if ((await explorerRow(orcaPage, 'index.ts').count()) === 0) {
    await explorerRow(orcaPage, 'src').click()
  }
  await expect(explorerRow(orcaPage, 'index.ts')).toBeVisible({ timeout: 10_000 })
  // Why: the root listing can predate the seeded writes; the watcher would catch up later.
  await orcaPage.getByRole('button', { name: 'Refresh Explorer' }).click()
  await expect(explorerRow(orcaPage, 'notes.md')).toBeVisible({ timeout: 10_000 })
  await orcaPage.evaluate(() => document.fonts.ready)

  for (const theme of ['dark', 'light'] as const) {
    await orcaPage.evaluate(
      (nextTheme) => window.__store!.getState().updateSettingsOrThrow({ theme: nextTheme }),
      theme
    )
    await expect(orcaPage.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
    await expectDecoratedTree(orcaPage)
    if (SCREENSHOT_DIR) {
      await mkdir(SCREENSHOT_DIR, { recursive: true })
      await orcaPage
        .locator('[data-orca-explorer-shell]')
        .screenshot({ path: `${SCREENSHOT_DIR}/explorer-${theme}.png` })
    }
  }
})
