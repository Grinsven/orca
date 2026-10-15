import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './golden-source-control'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './terminal'
import { nodeTerminalCommand } from '../terminal-node-command'

/** Mount and close real PTYs and Monaco editors, leaving one live terminal. */
export async function churnMemoryReleaseWindow(
  page: Page,
  repoPath: string,
  registerCleanup: (cleanup: () => Promise<void>) => void
): Promise<void> {
  for (let workspace = 0; workspace < 3; workspace += 1) {
    const fixture = createGoldenWorktree(repoPath, `memory-release-${workspace}`)
    registerCleanup(async () => cleanupGoldenWorktree(repoPath, fixture))
    const filePath = path.join(fixture.worktreePath, 'src', 'index.ts')
    const content = Array.from(
      { length: 3000 },
      (_, i) => `export const value${i} = "memory row ${i}"`
    ).join('\n')
    writeFileSync(filePath, content)
    await activateGoldenWorktree(page, repoPath, fixture.worktreePath)
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.createTab(state.activeWorktreeId!)
    })
    await waitForActiveTerminalManager(page)
    const ptyId = await waitForActivePanePtyId(page)
    const marker = `CHURN_DONE_${workspace}`
    await execInTerminal(
      page,
      ptyId,
      nodeTerminalCommand([
        '-e',
        `for(let i=0;i<6000;i++) console.log('memory churn '+i+' '+'.'.repeat(120)); console.log('CHURN_'+'DONE_${workspace}')`
      ])
    )
    await waitForTerminalOutput(page, marker, 30_000)
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await page.evaluate((filePath) => {
        const state = window.__store!.getState()
        state.openFile(
          {
            worktreeId: state.activeWorktreeId!,
            filePath,
            relativePath: 'src/index.ts',
            language: 'typescript',
            mode: 'edit'
          },
          { preview: false }
        )
      }, filePath)
      await page.locator('.monaco-editor').first().waitFor({ state: 'visible' })
      await page.evaluate(() => {
        const state = window.__store!.getState()
        for (const file of state.openFiles) {
          state.closeFile(file.id)
        }
      })
      await page.locator('.monaco-editor').first().waitFor({ state: 'detached' })
      await page.evaluate((filePath) => {
        const state = window.__store!.getState()
        state.openDiff(state.activeWorktreeId!, filePath, 'src/index.ts', 'typescript', false, {
          preview: false
        })
      }, filePath)
      await page.locator('.monaco-diff-editor').first().waitFor({ state: 'visible' })
      await page.evaluate(() => {
        const state = window.__store!.getState()
        for (const file of state.openFiles) {
          state.closeFile(file.id)
        }
      })
      await page.locator('.monaco-diff-editor').first().waitFor({ state: 'detached' })
    }
    const worktreeId = await page.evaluate(() => window.__store!.getState().activeWorktreeId)
    await page
      .locator(`[data-worktree-sidebar] [role="option"][data-worktree-id="${worktreeId}"]`)
      .first()
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Sleep', exact: true }).click()
    await page.locator('.xterm:visible').first().waitFor({ state: 'detached' })
    console.log(`Memory churn workspace ${workspace + 1}/3 complete`)
  }
  await activateGoldenWorktree(page, repoPath, repoPath)
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.createTab(state.activeWorktreeId!)
  })
  await waitForActiveTerminalManager(page)
  await waitForActivePanePtyId(page)
}
