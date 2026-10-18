import { expect, test } from './helpers/orca-app'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { waitForSessionReady } from './helpers/store'

for (const surface of ['palette', 'select'] as const) {
  test(`${surface} keeps modal scrollbar compensation outside the workspace`, async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await dismissTransientAnnouncement(orcaPage)
    await orcaPage.evaluate(async () => {
      await window.__store!.getState().updateSettingsOrThrow({
        uiLanguage: 'en',
        promptCacheTimerEnabled: true,
        promptCacheTtlMs: 300_000
      })
    })
    if (surface === 'select') {
      await orcaPage.getByRole('button', { name: 'Settings', exact: true }).click()
      await orcaPage
        .locator('.settings-view-shell aside')
        .getByRole('button', { name: 'Agents', exact: true })
        .click()
    }
    const trigger =
      surface === 'select'
        ? orcaPage
            .locator('[data-settings-section="agents"] [data-slot="select-trigger"]')
            .filter({ hasText: '5 minutes' })
            .first()
        : orcaPage.getByRole('button', { name: 'Search worktrees and browser tabs', exact: true })
    const content = orcaPage.locator(
      surface === 'select'
        ? '[data-slot="select-content"][data-state="open"]'
        : '[role="dialog"]:has(> .jump-palette-command)'
    )
    const before = await orcaPage.locator('#root').boundingBox()
    await trigger.click()
    await content.waitFor({ state: 'visible' })
    await orcaPage.waitForFunction(() => document.body.hasAttribute('data-scroll-locked'))
    const modal = await content.evaluate((element) => {
      const root = document.getElementById('root')
      const workspace = document.querySelector('.app-layout')
      if (!root || !workspace) {
        throw new Error('Workspace root is missing')
      }
      const property = '--removed-body-scroll-bar-size'
      const bodyValue = getComputedStyle(document.body).getPropertyValue(property).trim()
      return {
        bodyHasCompensation: bodyValue.length > 0,
        portalKeepsCompensation:
          getComputedStyle(element).getPropertyValue(property).trim() === bodyValue,
        rootCompensation: getComputedStyle(root).getPropertyValue(property).trim(),
        workspaceCompensation: getComputedStyle(workspace).getPropertyValue(property).trim(),
        bodyScrollLocked: getComputedStyle(document.body).overflowY === 'hidden',
        focusInsideModal: element.contains(document.activeElement)
      }
    })
    const during = await orcaPage.locator('#root').boundingBox()
    await orcaPage.keyboard.press('Escape')
    await content.waitFor({ state: 'hidden' })
    await orcaPage.waitForFunction(() => !document.body.hasAttribute('data-scroll-locked'))
    const restored = await orcaPage.evaluate(() => ({
      pointerUnlocked: document.body.style.pointerEvents !== 'none',
      compensationRemoved:
        getComputedStyle(document.body)
          .getPropertyValue('--removed-body-scroll-bar-size')
          .trim() === ''
    }))

    expect({
      modal,
      stableViewport: JSON.stringify(before) === JSON.stringify(during),
      restored
    }).toEqual({
      modal: {
        bodyHasCompensation: true,
        portalKeepsCompensation: true,
        rootCompensation: '',
        workspaceCompensation: '',
        bodyScrollLocked: true,
        focusInsideModal: true
      },
      stableViewport: true,
      restored: { pointerUnlocked: true, compensationRemoved: true }
    })
  })
}
