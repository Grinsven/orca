import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'

test.use({ minimumSeededWorktreeCount: 1 })

test('a terminal tab click activates its owner once and restores keyboard focus', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  const target = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const tabId = state.activeTabId!
    const groupId = state.activeGroupIdByWorktree[worktreeId]
    state.createTab(worktreeId)
    return { worktreeId, tabId, groupId }
  })
  await waitForActiveTerminalManager(orcaPage)
  const probe = await orcaPage.evaluateHandle(() => {
    const store = window.__store!
    const original = store.getState().activateTab
    let count = 0
    store.setState({
      activateTab: (...args: Parameters<typeof original>) => {
        count += 1
        original(...args)
      }
    })
    return {
      read: () => count,
      dispose: () => store.setState({ activateTab: original })
    }
  })
  try {
    await orcaPage.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    await orcaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${target.tabId}"]`).click()
    await orcaPage.waitForFunction((tabId) => {
      const state = window.__store!.getState()
      const pane = window.__paneManagers?.get(tabId)?.getActivePane()
      return state.activeTabId === tabId && pane?.terminal.textarea === document.activeElement
    }, target.tabId)
    const selection = await orcaPage.evaluate((worktreeId) => {
      const state = window.__store!.getState()
      return {
        worktreeId: state.activeWorktreeId,
        tabId: state.activeTabId,
        groupId: state.activeGroupIdByWorktree[worktreeId]
      }
    }, target.worktreeId)

    expect({ count: await probe.evaluate((value) => value.read()), selection }).toEqual({
      count: 1,
      selection: target
    })
  } finally {
    await probe.evaluate((value) => value.dispose())
    await probe.dispose()
  }
})
