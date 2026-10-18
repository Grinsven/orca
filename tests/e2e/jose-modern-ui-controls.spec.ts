import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getTerminalContent, waitForActiveTerminalManager } from './helpers/terminal'

test.use({ minimumSeededWorktreeCount: 1 })

test('Modern UI shortens control entrances and respects reduced motion', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const observations: {
    modernUi: boolean
    reducedMotion: 'no-preference' | 'reduce'
    menuMotion: { animation: string; duration: string; transition: string }
    settingsMotion: { animation: string; duration: string }
  }[] = []
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await orcaPage.emulateMedia({ reducedMotion })
    for (const modernUi of [true, false]) {
      await orcaPage.evaluate(async (enabled) => {
        await window.__store!.getState().updateSettingsOrThrow({ modernUi: enabled })
      }, modernUi)
      await orcaPage.waitForFunction(
        (enabled) => (document.documentElement.dataset.modernUi === 'on') === enabled,
        modernUi
      )
      await orcaPage.getByRole('button', { name: 'Help', exact: true }).click()
      const menu = orcaPage.locator('[data-slot="dropdown-menu-content"][data-state="open"]')
      await menu.waitFor({ state: 'visible' })
      const menuMotion = await menu.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          animation: style.animationName,
          duration: style.animationDuration,
          transition: style.transitionDuration
        }
      })
      await orcaPage.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
      await orcaPage.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = orcaPage.locator('.settings-view-shell')
      await settings.waitFor({ state: 'visible' })
      const settingsMotion = await settings.evaluate((element) => {
        const style = getComputedStyle(element)
        return { animation: style.animationName, duration: style.animationDuration }
      })
      observations.push({ modernUi, reducedMotion, menuMotion, settingsMotion })
      await orcaPage.getByRole('button', { name: 'Back to app', exact: true }).click()
      await settings.waitFor({ state: 'hidden' })
    }
  }

  expect(observations).toEqual([
    {
      modernUi: true,
      reducedMotion: 'no-preference',
      menuMotion: { animation: 'enter', duration: '0.08s', transition: '0.08s' },
      settingsMotion: { animation: 'settings-shell-enter', duration: '0.1s' }
    },
    {
      modernUi: false,
      reducedMotion: 'no-preference',
      menuMotion: { animation: 'enter', duration: '0.15s', transition: '0.15s' },
      settingsMotion: { animation: 'settings-shell-enter', duration: '0.18s' }
    },
    {
      modernUi: true,
      reducedMotion: 'reduce',
      menuMotion: { animation: 'none', duration: '0s', transition: '0.15s' },
      settingsMotion: { animation: 'none', duration: '0s' }
    },
    {
      modernUi: false,
      reducedMotion: 'reduce',
      menuMotion: { animation: 'none', duration: '0s', transition: '0.15s' },
      settingsMotion: { animation: 'settings-shell-enter', duration: '0.18s' }
    }
  ])
})

test('the Modern UI new-terminal menu hands keyboard input to its terminal', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettingsOrThrow({ modernUi: true })
  })
  const previousTab = await orcaPage.evaluate(() => window.__store!.getState().activeTabId)
  await orcaPage.getByRole('button', { name: 'New tab', exact: true }).click({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click()
  await orcaPage.waitForFunction((previous) => {
    const tabId = window.__store!.getState().activeTabId
    const pane = tabId ? window.__paneManagers?.get(tabId)?.getActivePane() : null
    return (
      tabId !== previous &&
      pane?.container.dataset.ptyId &&
      pane.serializeAddon.serialize().length > 0 &&
      pane.terminal.textarea === document.activeElement
    )
  }, previousTab)
  await orcaPage.keyboard.type("printf 'ORCA_%s\\n' MOTION_READY", { delay: 10 })
  await orcaPage.keyboard.press('Enter')
  await orcaPage.waitForFunction(() => {
    const tabId = window.__store!.getState().activeTabId
    const pane = tabId ? window.__paneManagers?.get(tabId)?.getActivePane() : null
    return pane?.serializeAddon.serialize().includes('ORCA_MOTION_READY')
  })

  expect(await getTerminalContent(orcaPage)).toContain('ORCA_MOTION_READY')
})
