import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { ONBOARDING_FINAL_STEP, ONBOARDING_FLOW_VERSION } from '../../../shared/onboarding-defaults'
import type { PersistedState } from '../../../shared/persisted-state-types'
import {
  getOrcaProfilesDirectory,
  legacyDataFilePath
} from '../../orca-profiles/profile-storage-paths'
import { readWsFallbackPort, writeWsFallbackPort } from '../../runtime/rpc/ws-fallback-port-store'

type SeedSource = {
  settings: GlobalSettings
  ui: PersistedState['ui']
  onboarding: PersistedState['onboarding']
}

// Accounts, cookies and pairing addresses belong to the host profile; window N reaches them through it.
const HOST_ONLY_SETTING_KEYS = [
  'codexManagedAccounts',
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime',
  'claudeManagedAccounts',
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'opencodeSessionCookie',
  'opencodeWorkspaceId',
  'minimaxGroupId',
  'machineName',
  'mobilePairingCustomAddress',
  'mobilePairingCustomAddresses',
  'telemetry'
] as const satisfies readonly (keyof GlobalSettings)[]

// Host-qualified orders, per-worktree maps and window bounds would point at window 1's local host.
const HOST_QUALIFIED_UI_KEYS = [
  'lastActiveRepoId',
  'lastActiveWorktreeId',
  'manualRepoOrder',
  'workspaceHostOrder',
  'workspaceHostScope',
  'automationHostFilter',
  'agentsVisibleHostIds',
  'filterRepoIds',
  'agentsFilterRepoIds',
  'explorerDisplayRootByWorktree',
  'showDotfilesByWorktree',
  'acknowledgedAgentsByPaneKey',
  'activityClearedAtByPaneKey',
  'manuallyUnreadTurnsByPaneKey',
  'setupScriptPromptDismissedRepoIds',
  'trustedOrcaHooks',
  'windowBounds',
  'windowMaximized'
] as const satisfies readonly (keyof PersistedState['ui'])[]

function omitKeys<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
  const copy: Partial<T> = { ...value }
  for (const key of keys) {
    delete copy[key]
  }
  return copy
}

/** The orca-data.json window N starts from: host look and feel, focused on the host runtime. */
export function buildSecondWindowSeed(
  source: SeedSource,
  environmentId: string,
  installId: string = randomUUID()
): {
  settings: Partial<GlobalSettings>
  ui: Partial<PersistedState['ui']>
  onboarding: PersistedState['onboarding']
} {
  const hostId = toRuntimeExecutionHostId(environmentId)
  const muted = source.settings.notifications.mutedNotificationSourceIds
  const settings: Partial<GlobalSettings> = {
    ...omitKeys(source.settings, HOST_ONLY_SETTING_KEYS),
    // Why fresh id: two installs reporting one id would merge in telemetry.
    telemetry: {
      optedIn: source.settings.telemetry?.optedIn ?? false,
      installId,
      existedBeforeTelemetryRelease: false
    },
    activeRuntimeEnvironmentId: environmentId,
    // Why: window 1 already raises the host's banners and sounds; a second copy would double them.
    notifications: {
      ...source.settings.notifications,
      mutedNotificationSourceIds: muted.includes(hostId) ? [...muted] : [...muted, hostId]
    },
    // Why identical: startup writes the chosen icon into the bundle both windows share.
    appIcon: source.settings.appIcon
  }
  const ui: Partial<PersistedState['ui']> = {
    ...omitKeys(source.ui, HOST_QUALIFIED_UI_KEYS),
    // Why: window N's own local host is empty; showing only the host runtime hides it.
    visibleWorkspaceHostIds: [hostId]
  }
  const onboarding: PersistedState['onboarding'] = {
    ...source.onboarding,
    flowVersion: ONBOARDING_FLOW_VERSION,
    closedAt: source.onboarding.closedAt ?? Date.now(),
    outcome: 'completed',
    lastCompletedStep: ONBOARDING_FINAL_STEP
  }
  return { settings, ui, onboarding }
}

/** First launch only: a slot that already has a profile keeps the choices made in that window. */
export function isSecondWindowSlotSeeded(slotDir: string): boolean {
  return existsSync(legacyDataFilePath(slotDir)) || existsSync(getOrcaProfilesDirectory(slotDir))
}

export function writeSecondWindowSeed(
  slotDir: string,
  seed: ReturnType<typeof buildSecondWindowSeed>
): void {
  mkdirSync(slotDir, { recursive: true, mode: 0o700 })
  const target = legacyDataFilePath(slotDir)
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, target)
}

export function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

/** Window N binds this before the preferred port, so it never takes the main window's 6768. */
export async function ensureSecondWindowWsPort(
  slotDir: string,
  findPort: () => Promise<number> = findFreeLoopbackPort
): Promise<void> {
  if (readWsFallbackPort(slotDir) !== undefined) {
    return
  }
  mkdirSync(slotDir, { recursive: true, mode: 0o700 })
  writeWsFallbackPort(slotDir, await findPort())
}
