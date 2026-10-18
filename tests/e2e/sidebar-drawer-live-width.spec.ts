import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

for (const drawer of ['workspace', 'agents'] as const) {
  test(`${drawer} drawer follows a resize through closed and open states`, async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await orcaPage.evaluate(async () => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Missing app store')
      }
      await state.updateSettings({
        modernUi: true,
        experimentalAgentDashboardPopout: true,
        experimentalAgentDashboardMode: 'in-window'
      })
      state.setUIZoomLevel(0)
      state.setSidebarOpen(true)
      state.setSidebarWidth(220)
      document.documentElement.style.setProperty('--workspace-sidebar-live-width', '999px')
    })
    const selector =
      drawer === 'workspace' ? '[data-workspace-board-sheet]' : '[data-agent-dashboard-sheet]'
    const toggle = async (open: boolean) => {
      await orcaPage.evaluate(
        ({ drawer, open }) => {
          if (drawer === 'workspace') {
            window.dispatchEvent(new Event('orca:toggle-workspace-board'))
          } else {
            window.__store?.getState().setAgentDashboardDrawerOpen(open)
          }
        },
        { drawer, open }
      )
    }
    const waitForDraft = async (width: number) => {
      await orcaPage.waitForFunction(
        ({ selector, width }) => {
          const sheet = document.querySelector(selector)
          return (
            sheet?.getAttribute('data-state') === 'open' &&
            sheet.closest('[data-sidebar-drawer-portal]') &&
            Math.abs(Number.parseFloat(getComputedStyle(sheet).left) - width) < 0.5
          )
        },
        { selector, width }
      )
    }
    const point = await orcaPage.locator('[data-sidebar-resize-handle]').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const y = Math.round(rect.y + rect.height / 2)
      for (let x = Math.ceil(rect.left) + 1; x < Math.floor(rect.right) - 1; x++) {
        if ([x - 1, x, x + 1].every((at) => element.contains(document.elementFromPoint(at, y)))) {
          return { x, y }
        }
      }
      throw new Error('No interior resize handle point')
    })
    await orcaPage.mouse.move(point.x, point.y)
    await orcaPage.mouse.down()
    try {
      await orcaPage.mouse.move(point.x + 60, point.y)
      await toggle(true)
      await waitForDraft(280)
      await orcaPage.mouse.move(point.x + 100, point.y)
      await waitForDraft(320)
      await toggle(false)
      await orcaPage.locator(`${selector}[data-state="open"]`).waitFor({ state: 'detached' })
      await orcaPage.mouse.move(point.x + 120, point.y)
      await toggle(true)
      await waitForDraft(340)
    } finally {
      await orcaPage.mouse.up()
    }
    await orcaPage.waitForFunction(() => window.__store?.getState().sidebarWidth === 340)
    expect(
      await orcaPage.evaluate(
        (selector) => ({
          rootWidth: document.documentElement.style.getPropertyValue(
            '--workspace-sidebar-live-width'
          ),
          left: Number.parseFloat(getComputedStyle(document.querySelector(selector)!).left),
          hosts: document.querySelectorAll('[data-sidebar-drawer-portal]').length
        }),
        selector
      )
    ).toEqual({ rootWidth: '999px', left: 340, hosts: 1 })
  })
}
