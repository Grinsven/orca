import { mkdir } from 'node:fs/promises'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Jose fork-local: Seti file icons, Material folder icons and VS Code style git decorations.
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
    const toPath = (relativePath: string): string =>
      [worktree.path, ...relativePath.split('/')].join(separator)
    const write = (relativePath: string, content: string): Promise<void> =>
      window.api.fs.writeFile({ filePath: toPath(relativePath), content })
    for (const folder of ['test', 'docs', '.github', 'recipes']) {
      // Why catch: createDir refuses an existing folder; a real failure resurfaces in the write.
      await window.api.fs.createDir({ dirPath: toPath(folder) }).catch(() => undefined)
    }
    await write('src/index.ts', 'export const hello = "changed"\n')
    await write('notes.md', '# Notes\n')
    await write('src/settings.json', '{}\n')
    await write('test/app.test.ts', 'export {}\n')
    await write('docs/guide.md', '# Guide\n')
    await write('.github/dependabot.yml', 'version: 2\n')
    // A folder name the icon theme does not know, so it keeps the default folder.
    await write('recipes/pancakes.txt', 'flour\n')
    state.setGitStatus(worktree.id, await window.api.git.status({ worktreePath: worktree.path }))
  })
}

function explorerRow(page: Page, name: string): Locator {
  const exactName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]', { hasText: exactName }) })
    .first()
}

function folderIcon(row: Locator): Locator {
  return row.locator('[data-material-folder-icon]')
}

/** Proves the bundled SVG behind the icon's background loads, instead of an empty box. */
async function expectFolderIconImageLoads(row: Locator): Promise<void> {
  const size = await folderIcon(row).evaluate(async (element) => {
    const url = /url\("(.+)"\)/.exec(getComputedStyle(element).backgroundImage)?.[1]
    if (!url) {
      return null
    }
    const image = new Image()
    image.src = url
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  })
  expect(size).not.toBeNull()
  expect(size!.width).toBeGreaterThan(0)
  expect(size!.height).toBeGreaterThan(0)
}

/** Icon box size and its vertical offset from the row's center, in CSS pixels. */
async function iconGeometry(
  row: Locator
): Promise<{ width: number; height: number; offset: number }> {
  return row.evaluate((element) => {
    const icon = element
      .querySelector<HTMLElement>('[data-seti-icon], [data-material-folder-icon]')!
      .getBoundingClientRect()
    const rowBox = element.getBoundingClientRect()
    return {
      width: icon.width,
      height: icon.height,
      offset: icon.top + icon.height / 2 - (rowBox.top + rowBox.height / 2)
    }
  })
}

async function expectFolderIcons(page: Page): Promise<void> {
  await expect(folderIcon(explorerRow(page, 'src'))).toHaveAttribute(
    'data-material-folder-icon',
    'folder-src-open'
  )
  await expect(folderIcon(explorerRow(page, 'test'))).toHaveAttribute(
    'data-material-folder-icon',
    'folder-test'
  )
  await expect(folderIcon(explorerRow(page, 'docs'))).toHaveAttribute(
    'data-material-folder-icon',
    'folder-docs'
  )
  await expect(folderIcon(explorerRow(page, '.github'))).toHaveAttribute(
    'data-material-folder-icon',
    'folder-github'
  )
  await expect(folderIcon(explorerRow(page, 'recipes'))).toHaveAttribute(
    'data-material-folder-icon',
    'folder'
  )
  for (const name of ['src', 'recipes']) {
    await expectFolderIconImageLoads(explorerRow(page, name))
  }
  // Folder and file icons share one box, centered in the row like the file glyphs.
  const folder = await iconGeometry(explorerRow(page, 'src'))
  const file = await iconGeometry(explorerRow(page, 'index.ts'))
  expect(folder.width).toBe(file.width)
  expect(folder.height).toBe(file.height)
  expect(Math.abs(folder.offset)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(file.offset)).toBeLessThanOrEqual(0.5)
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
  await expectFolderIcons(page)
  // The glyph comes from the bundled font, not a fallback box.
  const glyph = await indexRow.locator('[data-seti-icon]').evaluate((element) => {
    const before = getComputedStyle(element, '::before')
    return { content: before.content, font: before.fontFamily }
  })
  expect(glyph.content).not.toBe('none')
  expect(glyph.font).toContain('seti')
  expect(await page.evaluate(() => document.fonts.check('16px seti'))).toBe(true)
}

test('explorer shows Seti file icons, Material folder icons and VS Code git decorations', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await seedChanges(orcaPage)
  await openFileExplorer(orcaPage)
  const srcRow = explorerRow(orcaPage, 'src')
  await expect(srcRow).toBeVisible({ timeout: 10_000 })
  // Why: the root listing can predate the seeded writes; the watcher would catch up later.
  await orcaPage.getByRole('button', { name: 'Refresh Explorer' }).click()
  await expect(explorerRow(orcaPage, 'recipes')).toBeVisible({ timeout: 10_000 })
  if ((await explorerRow(orcaPage, 'index.ts').count()) > 0) {
    await srcRow.click()
  }
  await expect(explorerRow(orcaPage, 'index.ts')).toHaveCount(0)
  await expect(folderIcon(srcRow)).toHaveAttribute('data-material-folder-icon', 'folder-src')
  await expect(folderIcon(srcRow)).toHaveAttribute('data-explorer-folder-icon', 'closed')
  await srcRow.click()
  await expect(explorerRow(orcaPage, 'index.ts')).toBeVisible({ timeout: 10_000 })
  await expect(folderIcon(srcRow)).toHaveAttribute('data-material-folder-icon', 'folder-src-open')
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
