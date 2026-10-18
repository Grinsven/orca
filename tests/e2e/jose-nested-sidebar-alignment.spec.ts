import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { seedWorkspaceAgentStatus } from './worktree-lineage-state'

for (const newCardStyle of [true, false]) {
  test(`aligns nested section icons with working cards (${newCardStyle ? 'new' : 'legacy'})`, async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    const worktreeId = await orcaPage.evaluate(async (newCardStyle) => {
      const store = window.__store
      if (!store) {
        throw new Error('Missing app store')
      }
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo).flat()[0]
      if (!worktree) {
        throw new Error('Missing fixture workspace')
      }
      await state.updateSettings({ modernUi: true, experimentalNewWorktreeCardStyle: newCardStyle })
      await state.updateWorktreeMeta(worktree.id, { workspaceStatus: 'in-progress' })
      state.setUIZoomLevel(0)
      state.setSidebarWidth(220)
      state.setSidebarOpen(true)
      state.setGroupBy('repo')
      state.setHideDefaultBranchWorkspace(false)
      return worktree.id
    }, newCardStyle)
    await seedWorkspaceAgentStatus(orcaPage, worktreeId, 'alignment')

    for (const secondary of ['workspace-status', 'pr-status'] as const) {
      await orcaPage.evaluate((secondary) => {
        window.__store?.getState().setGroupBySecondary(secondary)
      }, secondary)
      await expect
        .poll(async () => {
          return orcaPage.evaluate((worktreeId) => {
            const row = document.querySelector(`[data-worktree-id=${JSON.stringify(worktreeId)}]`)
            const spinner = row?.querySelector(
              '[data-worktree-card-status-slot] [data-agent-spinner]'
            )
            const key = row?.getAttribute('data-worktree-section-key')
            const header = [...document.querySelectorAll('[data-worktree-virtual-row]')].find(
              (element) => element.getAttribute('data-worktree-virtual-row-key') === `hdr:${key}`
            )
            const icon = header?.querySelector('[role="button"] > div > div > svg')
            const surface = row?.querySelector('[data-worktree-card-surface]')
            if (!spinner || !icon || !surface) {
              return false
            }
            const a = spinner.getBoundingClientRect()
            const b = icon.getBoundingClientRect()
            const card = surface.getBoundingClientRect()
            return (
              Math.abs(a.x + a.width / 2 - b.x - b.width / 2) <= 0.5 &&
              a.left >= card.left &&
              a.right <= card.right
            )
          }, worktreeId)
        })
        .toBe(true)
    }
  })
}
