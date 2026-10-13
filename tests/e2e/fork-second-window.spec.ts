/**
 * Fork proof for Window > New Window: a second Orca on its own slot profile, paired to the hub
 * over loopback, with its own sidebar order and one worktree per window. Every instance runs on a
 * temp profile in the background; nothing here touches a real Orca.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { runCompiledOrcaCli } from './helpers/compiled-orca-cli'
import {
  activeEnvironmentId,
  activeWorktreeId,
  captureMainProcessLog,
  clickNewWindow,
  hostIdFor,
  hubWorktrees,
  isSecondWindow,
  LAUNCH_RECORD_PATH,
  launchSecondWindow,
  quitSecondWindow,
  readHubRuntimeDevices,
  readSlotEnvironments,
  removeSlotProfiles,
  rowLocator,
  waitForHostWorktree,
  type SecondWindow
} from './helpers/fork-second-window'

test.use({
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_FORK_WINDOW_LAUNCH_RECORD: LAUNCH_RECORD_PATH
  }
})

async function hubUserDataPath(app: Parameters<typeof clickNewWindow>[0]): Promise<string> {
  return app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
}

async function attachScreenshot(
  page: Page,
  name: string,
  testInfo: {
    outputPath: (n: string) => string
    attach: (n: string, o: { path: string; contentType: string }) => Promise<void>
  }
): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

test('New Window starts a second window already paired, and a relaunch keeps the pairing', async ({
  electronApp,
  orcaPage: hub
}, testInfo) => {
  test.setTimeout(300_000)
  const hubUserData = await hubUserDataPath(electronApp)
  const worktrees = await hubWorktrees(hub)
  const hubRepos = await hub.evaluate(() =>
    window.__store!.getState().repos.map((repo) => repo.displayName)
  )
  expect(worktrees.length).toBeGreaterThanOrEqual(2)
  let window2: SecondWindow | null = null
  try {
    const record = await clickNewWindow(electronApp)
    expect(record.slotDir).toBe(`${hubUserData}-window-2`)

    const environments = readSlotEnvironments(record.slotDir)
    expect(environments).toHaveLength(1)
    const environment = environments[0]!
    expect(JSON.stringify(environment)).toContain('ws://127.0.0.1:')
    expect(readHubRuntimeDevices(hubUserData)).toEqual([
      expect.objectContaining({ name: 'Orca window 2', pairingReach: 'this-computer' })
    ])
    const seed = JSON.parse(readFileSync(path.join(record.slotDir, 'orca-data.json'), 'utf8'))
    const hostId = hostIdFor(environment.id)
    expect(seed.settings.activeRuntimeEnvironmentId).toBe(environment.id)
    expect(seed.settings.notifications.mutedNotificationSourceIds).toContain(hostId)
    expect(seed.ui.visibleWorkspaceHostIds).toEqual([hostId])

    window2 = await launchSecondWindow(record, testInfo)
    const page = window2.page
    expect(await activeEnvironmentId(page)).toBe(environment.id)
    expect(await isSecondWindow(page)).toBe(true)
    expect(await isSecondWindow(hub)).toBe(false)
    await expect(page.locator('[data-onboarding-overlay]')).toHaveCount(0)
    const sidebar = page.locator('[data-worktree-sidebar]')
    await expect(sidebar).toBeVisible({ timeout: 60_000 })
    for (const name of hubRepos) {
      await expect(sidebar.getByText(name).first()).toBeVisible({ timeout: 60_000 })
    }
    for (const worktree of worktrees) {
      await waitForHostWorktree(page, worktree.id)
      await expect(rowLocator(page, worktree.id)).toBeVisible({ timeout: 30_000 })
    }
    const window2Settings = await page.evaluate(() => {
      const state = window.__store!.getState()
      return {
        muted: state.settings?.notifications.mutedNotificationSourceIds ?? [],
        visibleHosts: state.visibleWorkspaceHostIds ?? null
      }
    })
    expect(window2Settings.muted).toContain(hostId)
    await attachScreenshot(page, 'window-2-paired', testInfo)

    // A second click while window 2 runs opens window 3 instead of refocusing window 2.
    const third = await clickNewWindow(electronApp)
    expect(third.slotDir).toBe(`${hubUserData}-window-3`)
    expect(
      readHubRuntimeDevices(hubUserData)
        .map((device) => device.name)
        .sort()
    ).toEqual(['Orca window 2', 'Orca window 3'])

    await quitSecondWindow(window2)
    window2 = null

    // Relaunch: slot 2 is free again, keeps its environment and its device; no new pairing.
    const relaunch = await clickNewWindow(electronApp)
    expect(relaunch.slotDir).toBe(`${hubUserData}-window-2`)
    expect(readSlotEnvironments(relaunch.slotDir).map((entry) => entry.id)).toEqual([
      environment.id
    ])
    expect(readHubRuntimeDevices(hubUserData)).toHaveLength(2)
    window2 = await launchSecondWindow(relaunch, testInfo)
    expect(await activeEnvironmentId(window2.page)).toBe(environment.id)
    await waitForHostWorktree(window2.page, worktrees[0]!.id)
  } finally {
    if (window2) {
      await quitSecondWindow(window2)
    }
    removeSlotProfiles(hubUserData)
  }
})

test('New Window inside window 2 asks the hub, which opens the next window', async ({
  electronApp,
  orcaPage: hub
}, testInfo) => {
  test.setTimeout(300_000)
  const hubUserData = await hubUserDataPath(electronApp)
  expect(await isSecondWindow(hub)).toBe(false)
  let window2: SecondWindow | null = null
  try {
    window2 = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
    // The hub writes the record: only it can pair a new window to itself.
    const fromWindow2 = await clickNewWindow(window2.app)
    expect(fromWindow2.slotDir).toBe(`${hubUserData}-window-3`)
    expect(
      readHubRuntimeDevices(hubUserData)
        .map((device) => device.name)
        .sort()
    ).toEqual(['Orca window 2', 'Orca window 3'])
    expect(readSlotEnvironments(fromWindow2.slotDir)).toHaveLength(1)
  } finally {
    if (window2) {
      await quitSecondWindow(window2)
    }
    removeSlotProfiles(hubUserData)
  }
})

test('a worktree lives in one window: clicking it in the other raises its owner', async ({
  electronApp,
  orcaPage: hub
}, testInfo) => {
  test.setTimeout(300_000)
  const hubUserData = await hubUserDataPath(electronApp)
  const [first, second] = await hubWorktrees(hub)
  const worktreeA = first!
  const worktreeB = second!
  const hubLog = captureMainProcessLog(electronApp)
  let window2: SecondWindow | null = null
  try {
    await rowLocator(hub, worktreeA.id).click()
    await expect.poll(() => activeWorktreeId(hub)).toBe(worktreeA.id)

    window2 = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
    const page = window2.page
    await waitForHostWorktree(page, worktreeB.id)
    await rowLocator(page, worktreeB.id).click()
    await expect.poll(() => activeWorktreeId(page), { timeout: 30_000 }).toBe(worktreeB.id)
    // Terminals of window 2 run on the hub: the hub's CLI sees window 2's terminal in B.
    await expect
      .poll(
        async () => {
          const listed = await runCompiledOrcaCli(hubUserData, ['terminal', 'list', '--json'])
          return JSON.stringify(listed.json?.result ?? null).includes(worktreeB.path)
        },
        { timeout: 60_000 }
      )
      .toBe(true)

    // Window 2 clicks A, which the hub owns: window 2 stays on B and the hub is raised on A.
    hubLog.clear()
    await rowLocator(page, worktreeA.id).click()
    await expect
      .poll(() => hubLog.lines().some((line) => line.includes('[jose-window] raise:')), {
        timeout: 30_000
      })
      .toBe(true)
    expect(await activeWorktreeId(page)).toBe(worktreeB.id)
    expect(await activeWorktreeId(hub)).toBe(worktreeA.id)
    await expect(rowLocator(page, worktreeB.id)).toHaveAttribute('aria-current', /true|page/)
    await attachScreenshot(page, 'window-2-after-clicking-hub-owned-A', testInfo)

    // The reverse: the hub clicks B, which window 2 owns.
    window2.log.clear()
    await rowLocator(hub, worktreeB.id).click()
    await expect
      .poll(() => window2!.log.lines().some((line) => line.includes('[jose-window] raise:')), {
        timeout: 30_000
      })
      .toBe(true)
    expect(await activeWorktreeId(hub)).toBe(worktreeA.id)
    expect(await activeWorktreeId(page)).toBe(worktreeB.id)
    await attachScreenshot(hub, 'hub-after-clicking-window-2-owned-B', testInfo)
  } finally {
    if (window2) {
      await quitSecondWindow(window2)
    }
    removeSlotProfiles(hubUserData)
  }
})

test('a file open for a worktree owned by window 2 lands there, and a refused restore picks a valid worktree', async ({
  electronApp,
  orcaPage: hub
}, testInfo) => {
  test.setTimeout(420_000)
  const hubUserData = await hubUserDataPath(electronApp)
  const all = await hubWorktrees(hub)
  const linked = all.filter((worktree) => worktree.path !== all[0]!.path)
  const [worktreeA, worktreeB] = linked.length >= 2 ? linked : all
  writeFileSync(path.join(worktreeA!.path, 'owned-note.md'), '# Opened in window 2\n')
  let window2: SecondWindow | null = null
  try {
    await hub.evaluate((id) => window.__store!.getState().setActiveWorktree(id), worktreeB!.id)
    const record = await clickNewWindow(electronApp)
    window2 = await launchSecondWindow(record, testInfo)
    const environmentId = (await activeEnvironmentId(window2.page))!
    const hostId = hostIdFor(environmentId)
    await waitForHostWorktree(window2.page, worktreeA!.id)
    await window2.page.evaluate(
      ({ a, b, host }) => {
        const state = window.__store!.getState()
        state.markWorktreeVisited(b, Date.now() - 10_000, host)
        state.setActiveWorktree(a, host)
        state.markWorktreeVisited(a, Date.now(), host)
      },
      { a: worktreeA!.id, b: worktreeB!.id, host: hostId }
    )
    await expect.poll(() => activeWorktreeId(window2!.page)).toBe(worktreeA!.id)
    await window2.page.waitForTimeout(2_000)
    const hubActiveBefore = await activeWorktreeId(hub)

    const cli = await runCompiledOrcaCli(hubUserData, [
      'file',
      'open',
      'owned-note.md',
      '--worktree',
      `path:${worktreeA!.path}`,
      '--focus',
      '--json'
    ])
    expect(cli.code, `${cli.stdout}\n${cli.stderr}`).toBe(0)
    await expect
      .poll(
        () =>
          window2!.page.evaluate(() =>
            window
              .__store!.getState()
              .openFiles.some((file) => file.filePath.endsWith('owned-note.md'))
          ),
        { timeout: 30_000 }
      )
      .toBe(true)
    const window2After = await window2.page.evaluate(() => {
      const state = window.__store!.getState()
      return {
        activeWorktreeId: state.activeWorktreeId,
        activeTabType: state.activeTabType,
        activeFileId: state.activeFileId
      }
    })
    expect(window2After.activeWorktreeId).toBe(worktreeA!.id)
    expect(window2After.activeTabType).toBe('editor')
    expect(window2After.activeFileId ?? '').toContain('owned-note.md')
    expect(await activeWorktreeId(hub)).toBe(hubActiveBefore)
    expect(
      await hub.evaluate(() =>
        window
          .__store!.getState()
          .openFiles.filter((file) => file.filePath.endsWith('owned-note.md'))
      )
    ).toEqual([])
    await attachScreenshot(window2.page, 'window-2-after-cli-file-open', testInfo)

    // Window 2 quits on A, the hub takes A, so window 2's startup restore of A is refused.
    await quitSecondWindow(window2)
    window2 = null
    await hub.evaluate((id) => window.__store!.getState().setActiveWorktree(id), worktreeA!.id)
    await hub.waitForTimeout(2_000)
    window2 = await launchSecondWindow(record, testInfo)
    await expect
      .poll(() => activeWorktreeId(window2!.page), { timeout: 60_000 })
      .toBe(worktreeB!.id)
    expect(await activeWorktreeId(hub)).toBe(worktreeA!.id)
    await attachScreenshot(window2.page, 'window-2-after-refused-restore', testInfo)
  } finally {
    if (window2) {
      await quitSecondWindow(window2)
    }
    removeSlotProfiles(hubUserData)
  }
})

test.describe('per-window sidebar order', () => {
  test('window 2 sorts on its own: its smart order never rewrites the hub order', async ({
    electronApp,
    orcaPage: hub,
    seededRepoPath
  }, testInfo) => {
    test.setTimeout(300_000)
    const hubUserData = await hubUserDataPath(electronApp)
    // A third worktree, so window 2 has two the hub does not own; removed in finally.
    const extraBranch = `e2e-window-sort-${process.pid}-${Date.now()}`
    const extraPath = path.join(os.tmpdir(), extraBranch)
    execFileSync('git', ['-C', seededRepoPath, 'worktree', 'add', '-b', extraBranch, extraPath])
    await hub.evaluate(async () => {
      const state = window.__store!.getState()
      await Promise.all(state.repos.map((repo) => state.fetchWorktrees(repo.id)))
    })
    await expect.poll(async () => (await hubWorktrees(hub)).length).toBeGreaterThanOrEqual(3)
    const worktrees = await hubWorktrees(hub)
    const readHubSortOrder = (): Promise<Record<string, number>> =>
      hub.evaluate(async () => {
        const listed = await window.api.worktrees.listAll()
        return Object.fromEntries(listed.map((worktree) => [worktree.id, worktree.sortOrder]))
      })
    let window2: SecondWindow | null = null
    try {
      // The hub never persists in Name sort, so any sortOrder change below comes from window 2.
      await hub.evaluate(() => window.__store!.getState().setSortBy('name'))
      const before = await readHubSortOrder()

      window2 = await launchSecondWindow(await clickNewWindow(electronApp), testInfo)
      const page = window2.page
      await page.evaluate(() => window.__store!.getState().setSortBy('smart'))
      // The hub owns its active worktree, so window 2 works in the others.
      const hubActive = await activeWorktreeId(hub)
      const free = worktrees.filter((worktree) => worktree.id !== hubActive)
      expect(free.length).toBeGreaterThanOrEqual(2)
      for (const worktree of free.toReversed()) {
        await waitForHostWorktree(page, worktree.id)
        await rowLocator(page, worktree.id).click()
        await expect.poll(() => activeWorktreeId(page), { timeout: 30_000 }).toBe(worktree.id)
        // A live terminal on the host is the signal that makes Smart persist.
        await expect
          .poll(
            () =>
              page.evaluate(
                (id) => (window.__store!.getState().tabsByWorktree[id] ?? []).length,
                worktree.id
              ),
            { timeout: 30_000 }
          )
          .toBeGreaterThan(0)
      }
      await page.waitForTimeout(5_000)
      expect(await readHubSortOrder()).toEqual(before)
      expect(await hub.evaluate(() => window.__store!.getState().sortBy)).toBe('name')
      expect(await page.evaluate(() => window.__store!.getState().sortBy)).toBe('smart')
      await attachScreenshot(page, 'window-2-smart-sort', testInfo)
    } finally {
      if (window2) {
        await quitSecondWindow(window2)
      }
      removeSlotProfiles(hubUserData)
      execFileSync('git', ['-C', seededRepoPath, 'worktree', 'remove', '--force', extraPath])
      execFileSync('git', ['-C', seededRepoPath, 'branch', '-D', extraBranch])
    }
  })
})
