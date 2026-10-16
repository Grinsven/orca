import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId } from './helpers/terminal'

test('Resource Manager X kills a bound terminal without confirmation', async ({
  orcaPage: page
}, testInfo) => {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const ptyId = await waitForActivePanePtyId(page)
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.evaluate(() => window.__store!.getState().fetchMemorySnapshot())
  await page.getByRole('button', { name: /^Resource Manager,/ }).click()

  const popover = page.getByRole('dialog')
  const killButton = popover.getByRole('button', { name: `Kill session ${ptyId}`, exact: true })
  await killButton.waitFor({ state: 'visible' })
  const wasBound = await killButton.evaluate((button) =>
    Boolean(button.closest('[data-worktree-id][role="button"]'))
  )
  await killButton.focus()
  const before = testInfo.outputPath('resource-manager-before.png')
  await page.screenshot({ path: before, animations: 'disabled' })
  await testInfo.attach('Resource Manager before X', { path: before, contentType: 'image/png' })

  await killButton.click()
  await killButton.waitFor({ state: 'detached' })
  await page.waitForFunction(
    async (id) => !(await window.api.pty.listSessions()).some((session) => session.id === id),
    ptyId
  )
  const body = popover.locator(':scope > div[tabindex="-1"]')
  await expect
    .poll(async () => ({
      wasBound,
      rows: await killButton.count(),
      dialogs: await page.getByRole('dialog').count(),
      confirmationButtons: await page
        .getByRole('button', { name: 'Kill session', exact: true })
        .count(),
      listVisible: await body.isVisible(),
      focusInList: await body.evaluate((element) => document.activeElement === element)
    }))
    .toEqual({
      wasBound: true,
      rows: 0,
      dialogs: 1,
      confirmationButtons: 0,
      listVisible: true,
      focusInList: true
    })
  const after = testInfo.outputPath('resource-manager-after.png')
  await page.screenshot({ path: after, animations: 'disabled' })
  await testInfo.attach('Resource Manager after X', { path: after, contentType: 'image/png' })
})
