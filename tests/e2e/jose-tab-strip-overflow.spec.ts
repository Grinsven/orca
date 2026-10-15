import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('connected tabs only scroll when their slots overflow', async ({ orcaPage, electronApp }) => {
  await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(async () => {
    await window
      .__store!.getState()
      .updateSettingsOrThrow({ theme: 'dark', modernUi: true, modernUiTabStyle: 'connected' })
    await window.api.ui.set({ uiZoomLevel: 0.5 })
  })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const strip = orcaPage.locator('.terminal-tab-strip').first()
  const tab = strip.locator('[data-testid="sortable-tab"]').first()
  const tabId = await tab.getAttribute('data-tab-id')
  if (!tabId) {
    throw new Error('Fixture terminal tab is missing')
  }
  await orcaPage.evaluate(
    (id) =>
      window
        .__store!.getState()
        .updateTabTitle(
          id,
          'A deliberately long terminal title that is truncated even though this single tab fits'
        ),
    tabId
  )
  await tab.locator('.truncate').waitFor()
  async function metrics() {
    return strip.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      slotWidths: Array.from(
        element.querySelectorAll(':scope > [data-tab-strip-slot]'),
        (slot) => slot.getBoundingClientRect().width
      ),
      titleTruncated: Array.from(element.querySelectorAll<HTMLElement>('.truncate')).some(
        (label) => label.scrollWidth > label.clientWidth
      ),
      arrows: element.parentElement?.parentElement?.querySelectorAll('[aria-label^="Scroll tabs "]')
        .length,
      rails: element.parentElement?.querySelectorAll('[data-testid="tab-strip-scroll-indicator"]')
        .length
    }))
  }
  await orcaPage
    .getByRole('button', { name: 'Scroll tabs right', exact: true })
    .waitFor({ state: 'detached' })
  const single = await metrics()
  const zoom = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()
  )
  const cdp = await orcaPage.context().newCDPSession(orcaPage)
  async function screenshot(name: string): Promise<void> {
    const directory = process.env.JOSE_SIDEBAR_SCREENSHOT_DIR
    if (!directory) {
      return
    }
    await mkdir(directory, { recursive: true })
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(directory, name), Buffer.from(data, 'base64'))
  }
  await screenshot('tab-strip-one-tab.png')
  const addedIds = await orcaPage.evaluate(
    (id) =>
      Array.from(
        { length: 24 },
        () => window.__store!.getState().createTab(id, undefined, undefined, { activate: false }).id
      ),
    worktreeId
  )
  const right = orcaPage.getByRole('button', { name: 'Scroll tabs right', exact: true })
  const left = orcaPage.getByRole('button', { name: 'Scroll tabs left', exact: true })
  await right.waitFor()
  await strip.evaluate((element) => {
    element.scrollLeft = 0
  })
  await right.click()
  await orcaPage.waitForFunction(
    () => document.querySelector('.terminal-tab-strip')!.scrollLeft > 10
  )
  const afterRight = (await metrics()).scrollLeft
  await left.click()
  await orcaPage.waitForFunction(
    (previous) => document.querySelector('.terminal-tab-strip')!.scrollLeft < previous - 10,
    afterRight
  )
  await strip.evaluate((element) => {
    element.scrollLeft = 0
  })
  await strip.hover()
  await orcaPage.mouse.wheel(220, 0)
  await orcaPage.waitForFunction(
    () => document.querySelector('.terminal-tab-strip')!.scrollLeft > 10
  )
  const many = await metrics()
  await screenshot('tab-strip-many-tabs.png')
  await orcaPage.evaluate((ids) => {
    const state = window.__store!.getState()
    for (const id of ids) {
      state.closeTab(id)
    }
  }, addedIds)
  await right.waitFor({ state: 'detached' })
  const returned = await metrics()
  await cdp.detach()
  expect({
    zoom,
    single: {
      arrows: single.arrows,
      rails: single.rails,
      fits: single.scrollWidth <= single.clientWidth + 1,
      truncated: single.titleTruncated
    },
    many: {
      arrows: many.arrows,
      rails: many.rails,
      movedByArrow: afterRight > 10,
      movedByWheel: many.scrollLeft > 10,
      overflows: many.scrollWidth > many.clientWidth + 1
    },
    returned: { arrows: returned.arrows, rails: returned.rails }
  }).toEqual({
    zoom: 0.5,
    single: { arrows: 0, rails: 0, fits: true, truncated: true },
    many: { arrows: 2, rails: 0, movedByArrow: true, movedByWheel: true, overflows: true },
    returned: { arrows: 0, rails: 0 }
  })
})
