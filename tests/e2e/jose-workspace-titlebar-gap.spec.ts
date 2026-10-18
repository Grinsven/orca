import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

test('Modern UI joins the workspace to its titlebar across page layouts', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettingsOrThrow({
      modernUi: true,
      modernUiDensity: 'default'
    })
  })
  const cases = [
    { view: 'terminal', sidebarOpen: true, activeWorktree: true, joined: false },
    { view: 'settings', sidebarOpen: true, activeWorktree: true, joined: true },
    { view: 'tasks', sidebarOpen: true, activeWorktree: true, joined: true },
    { view: 'automations', sidebarOpen: true, activeWorktree: true, joined: false },
    { view: 'artifacts', sidebarOpen: true, activeWorktree: true, joined: false },
    { view: 'terminal', sidebarOpen: true, activeWorktree: false, joined: true },
    { view: 'terminal', sidebarOpen: false, activeWorktree: true, joined: false },
    { view: 'settings', sidebarOpen: false, activeWorktree: true, joined: true },
    { view: 'automations', sidebarOpen: false, activeWorktree: true, joined: true }
  ] as const
  const observations: {
    view: string
    sidebarOpen: boolean
    activeWorktree: boolean
    joined: boolean
  }[] = []
  for (const scenario of cases) {
    await orcaPage.evaluate(
      ({ scenario, worktreeId }) => {
        const state = window.__store!.getState()
        state.setActiveWorktree(scenario.activeWorktree ? worktreeId : null)
        state.setSidebarOpen(scenario.sidebarOpen)
        state.setActiveView(scenario.view)
      },
      { scenario, worktreeId }
    )
    await orcaPage.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    const spacing = await orcaPage.locator('[data-orca-region="workspace"]').evaluate((element) => {
      const gap = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modern-ui-gap')
      )
      const margin = Number.parseFloat(getComputedStyle(element).marginTop)
      if (margin !== 0 && margin !== gap) {
        throw new Error(`Unexpected workspace margin: ${margin}`)
      }
      return margin === 0
    })
    observations.push({ ...scenario, joined: spacing })
  }

  expect(observations).toEqual(cases)
})
