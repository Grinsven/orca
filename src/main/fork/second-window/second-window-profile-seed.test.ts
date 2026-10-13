import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings, getDefaultUIState } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { getDefaultOnboardingState } from '../../../shared/onboarding-defaults'
import type { OnboardingState } from '../../../shared/onboarding-state-types'
import { readWsFallbackPort } from '../../runtime/rpc/ws-fallback-port-store'
import {
  buildSecondWindowSeed,
  ensureSecondWindowWsPort,
  findFreeLoopbackPort,
  isSecondWindowSlotSeeded,
  writeSecondWindowSeed
} from './second-window-profile-seed'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-second-window-seed-'))
  dirs.push(dir)
  return dir
}

function hostSource() {
  const defaults = getDefaultSettings('/Users/jose')
  const settings: GlobalSettings = {
    ...defaults,
    theme: 'dark',
    appIcon: defaults.appIcon,
    terminalFontSize: 15,
    activeCodexManagedAccountId: 'codex-1',
    activeClaudeManagedAccountId: 'claude-1',
    opencodeSessionCookie: 'secret-cookie',
    minimaxGroupId: 'group',
    machineName: 'Studio MacBook',
    activeRuntimeEnvironmentId: null,
    telemetry: { optedIn: true, installId: 'host-install-id', existedBeforeTelemetryRelease: true },
    notifications: { ...defaults.notifications, mutedNotificationSourceIds: ['ssh:box'] }
  }
  const ui = {
    ...getDefaultUIState(),
    sortBy: 'smart' as const,
    uiZoomLevel: 0.5,
    lastActiveRepoId: 'repo-1',
    lastActiveWorktreeId: 'repo-1::/wt',
    manualRepoOrder: [],
    workspaceHostOrder: ['local' as const],
    filterRepoIds: ['repo-1'],
    windowBounds: { x: 0, y: 0, width: 800, height: 600 },
    showDotfilesByWorktree: { 'repo-1::/wt': true }
  }
  const onboarding: OnboardingState = {
    ...getDefaultOnboardingState(),
    closedAt: 1234,
    outcome: 'completed',
    lastCompletedStep: 5
  }
  return { settings, ui, onboarding }
}

describe('buildSecondWindowSeed', () => {
  it('copies host look and feel but drops account, telemetry and pairing identities', () => {
    const seed = buildSecondWindowSeed(hostSource(), 'env-1', 'fresh-install-id')

    expect(seed.settings).toMatchObject({ theme: 'dark', terminalFontSize: 15 })
    for (const key of [
      'codexManagedAccounts',
      'activeCodexManagedAccountId',
      'claudeManagedAccounts',
      'activeClaudeManagedAccountId',
      'opencodeSessionCookie',
      'minimaxGroupId',
      'machineName'
    ]) {
      expect(seed.settings).not.toHaveProperty(key)
    }
    expect(seed.settings.telemetry).toEqual({
      optedIn: true,
      installId: 'fresh-install-id',
      existedBeforeTelemetryRelease: false
    })
    expect(JSON.stringify(seed)).not.toContain('host-install-id')
    expect(JSON.stringify(seed)).not.toContain('secret-cookie')
    expect(JSON.stringify(seed)).not.toContain('codex-1')
  })

  it('points the window at the host runtime and mutes its notifications', () => {
    const source = hostSource()
    const seed = buildSecondWindowSeed(source, 'env-1')

    expect(seed.settings.activeRuntimeEnvironmentId).toBe('env-1')
    expect(seed.settings.appIcon).toBe(source.settings.appIcon)
    expect(seed.settings.notifications?.mutedNotificationSourceIds).toEqual([
      'ssh:box',
      'runtime:env-1'
    ])
    expect(source.settings.notifications.mutedNotificationSourceIds).toEqual(['ssh:box'])
    expect(seed.ui.visibleWorkspaceHostIds).toEqual(['runtime:env-1'])
  })

  it('does not mute the host twice', () => {
    const source = hostSource()
    source.settings.notifications.mutedNotificationSourceIds = ['runtime:env-1']
    expect(
      buildSecondWindowSeed(source, 'env-1').settings.notifications?.mutedNotificationSourceIds
    ).toEqual(['runtime:env-1'])
  })

  it('keeps sidebar preferences and drops host-qualified order and per-worktree state', () => {
    const seed = buildSecondWindowSeed(hostSource(), 'env-1')

    expect(seed.ui).toMatchObject({ sortBy: 'smart', uiZoomLevel: 0.5 })
    for (const key of [
      'lastActiveRepoId',
      'lastActiveWorktreeId',
      'manualRepoOrder',
      'workspaceHostOrder',
      'filterRepoIds',
      'windowBounds',
      'showDotfilesByWorktree'
    ]) {
      expect(seed.ui).not.toHaveProperty(key)
    }
  })

  it('marks onboarding completed even when the host never closed it', () => {
    const source = hostSource()
    source.onboarding = getDefaultOnboardingState()
    const seed = buildSecondWindowSeed(source, 'env-1')
    expect(seed.onboarding.closedAt).toEqual(expect.any(Number))
    expect(seed.onboarding.outcome).toBe('completed')
    expect(buildSecondWindowSeed(hostSource(), 'env-1').onboarding.closedAt).toBe(1234)
  })
})

describe('slot profile files', () => {
  it('writes the seed once and treats an existing profile as seeded', () => {
    const slotDir = join(tempDir(), 'orca-window-2')
    expect(isSecondWindowSlotSeeded(slotDir)).toBe(false)
    writeSecondWindowSeed(slotDir, buildSecondWindowSeed(hostSource(), 'env-1'))
    const written = JSON.parse(readFileSync(join(slotDir, 'orca-data.json'), 'utf8'))
    expect(written.settings.activeRuntimeEnvironmentId).toBe('env-1')
    expect(existsSync(join(slotDir, 'orca-data.json.tmp'))).toBe(false)
    expect(isSecondWindowSlotSeeded(slotDir)).toBe(true)

    const migrated = tempDir()
    mkdirSync(join(migrated, 'profiles'))
    expect(isSecondWindowSlotSeeded(migrated)).toBe(true)
  })

  it('seeds a WebSocket fallback port once', async () => {
    const slotDir = join(tempDir(), 'orca-window-2')
    const findPort = vi.fn(async () => 51999)
    await ensureSecondWindowWsPort(slotDir, findPort)
    await ensureSecondWindowWsPort(slotDir, findPort)
    expect(readWsFallbackPort(slotDir)).toBe(51999)
    expect(findPort).toHaveBeenCalledTimes(1)
  })

  it('finds a real free loopback port', async () => {
    const port = await findFreeLoopbackPort()
    expect(port).toBeGreaterThan(0)
    expect(port).not.toBe(6768)
  })
})
