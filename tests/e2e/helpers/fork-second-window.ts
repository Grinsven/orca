/**
 * Fork (second window) harness: the hub's Window > New Window writes a launch record instead of
 * spawning (ORCA_FORK_WINDOW_LAUNCH_RECORD), and these helpers start window N from it on its own
 * slot profile, the way a real launch would, without selecting the environment by hand.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@stablyai/playwright-test'
import { createElectronHomeIsolation } from './electron-home-isolation'
import { getOrcaElectronLaunchArgs } from './electron-launch-args'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './electron-process-shutdown'
import { forwardElectronProcessLogs } from './orca-app'

export const NEW_WINDOW_MENU_ITEM_ID = 'fork-new-orca-window'

/** One file per Playwright worker process; each click overwrites it. */
export const LAUNCH_RECORD_PATH = path.join(
  os.tmpdir(),
  `orca-e2e-second-window-launch-${process.pid}.json`
)

export type LaunchRecord = {
  mode: string
  slotDir: string
  envOverrides: Record<string, string>
}

export type SecondWindow = {
  app: ElectronApplication
  page: Page
  log: MainProcessLog
  slotDir: string
}

export type MainProcessLog = { lines: () => string[]; clear: () => void }

export type SlotEnvironment = { id: string; name: string; endpoints?: unknown }

type HubDevice = { deviceId: string; name: string; scope: string; pairingReach?: string }

/** Main-process stdout/stderr lines from now on, for `[jose-window] raise:` style evidence. */
export function captureMainProcessLog(app: ElectronApplication): MainProcessLog {
  let lines: string[] = []
  const onData = (chunk: Buffer): void => {
    lines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean))
  }
  app.process().stdout?.on('data', onData)
  app.process().stderr?.on('data', onData)
  return { lines: () => [...lines], clear: () => (lines = []) }
}

export async function clickNewWindow(hubApp: ElectronApplication): Promise<LaunchRecord> {
  rmSync(LAUNCH_RECORD_PATH, { force: true })
  const clicked = await hubApp.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    item?.click()
    return Boolean(item)
  }, NEW_WINDOW_MENU_ITEM_ID)
  expect(clicked, 'Window > New Window is in the hub menu').toBe(true)
  await expect.poll(() => existsSync(LAUNCH_RECORD_PATH), { timeout: 30_000 }).toBe(true)
  return JSON.parse(readFileSync(LAUNCH_RECORD_PATH, 'utf8'))
}

export function isSecondWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => Reflect.get(window, 'joseWindow')?.isSecondWindow === true)
}

export async function launchSecondWindow(
  record: LaunchRecord,
  testInfo: TestInfo
): Promise<SecondWindow> {
  const { ELECTRON_RUN_AS_NODE: _unused, ...cleanEnv } = process.env
  void _unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv: cleanEnv,
    launchEnv: { NODE_ENV: 'development' },
    extraEnv: {},
    userDataDir: record.slotDir
  })
  const app = await electron.launch({
    args: getOrcaElectronLaunchArgs(path.join(process.cwd(), 'out', 'main', 'index.js'), false),
    env: {
      ...isolation.env,
      ...record.envOverrides,
      ORCA_BACKGROUND_LAUNCH: '1',
      NODE_ENV: 'development',
      ORCA_E2E_HEADLESS: '1',
      // Why: E2E skips the profile lock by default, and New Window reads that lock to see a running slot.
      ORCA_E2E_ENFORCE_SINGLE_INSTANCE_LOCK: '1'
    }
  })
  const log = captureMainProcessLog(app)
  forwardElectronProcessLogs(app, testInfo)
  try {
    const page = await app.firstWindow({ timeout: 120_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(
      () => window.__store?.getState().workspaceSessionReady === true,
      null,
      { timeout: 60_000 }
    )
    return { app, page, log, slotDir: record.slotDir }
  } catch (error) {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(record.slotDir)
    throw error
  }
}

export async function quitSecondWindow(window: SecondWindow): Promise<void> {
  await closeElectronAppForE2E(window.app)
  await cleanupE2EDaemons(window.slotDir)
}

export function removeSlotProfiles(hubUserData: string): void {
  for (let n = 2; n <= 5; n += 1) {
    rmSync(`${hubUserData}-window-${n}`, { recursive: true, force: true })
  }
  rmSync(LAUNCH_RECORD_PATH, { force: true })
}

export function readSlotEnvironments(slotDir: string): SlotEnvironment[] {
  return JSON.parse(readFileSync(path.join(slotDir, 'orca-environments.json'), 'utf8')).environments
}

export function readHubRuntimeDevices(hubUserData: string): HubDevice[] {
  const devices: HubDevice[] = JSON.parse(
    readFileSync(path.join(hubUserData, 'orca-devices.json'), 'utf8')
  )
  return devices.filter((device) => device.scope === 'runtime')
}

export function rowLocator(page: Page, worktreeId: string) {
  return page
    .locator(
      `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(worktreeId)}]`
    )
    .first()
}

export function activeWorktreeId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__store!.getState().activeWorktreeId)
}

export function activeEnvironmentId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => window.__store!.getState().settings?.activeRuntimeEnvironmentId ?? null
  )
}

/** The hub's two seeded worktrees, as ids every paired window shares. */
export function hubWorktrees(hub: Page): Promise<{ id: string; path: string; name: string }[]> {
  return hub.evaluate(() =>
    Object.values(window.__store!.getState().worktreesByRepo)
      .flat()
      .map((worktree) => ({
        id: worktree.id,
        path: worktree.path,
        name: worktree.displayName
      }))
  )
}

export function hostIdFor(environmentId: string): `runtime:${string}` {
  return `runtime:${encodeURIComponent(environmentId)}`
}

export async function waitForHostWorktree(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            Object.values(window.__store!.getState().worktreesByRepo)
              .flat()
              .some((worktree) => worktree.id === id),
          worktreeId
        ),
      { timeout: 60_000 }
    )
    .toBe(true)
}
