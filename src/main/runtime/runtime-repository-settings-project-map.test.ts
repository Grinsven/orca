import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { RuntimeRepositorySettingsController } from './runtime-repository-settings-controller'
import type { RuntimeStore } from './runtime-store-contract'

const MAP_PATH = '/srv/repo/docs/project-map.html'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/srv/repo',
    displayName: 'Repo',
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

function makeController() {
  const repo = makeRepo()
  const updateRepo = vi.fn<RuntimeStore['updateRepo']>(() => repo)
  const notifyReposChanged = vi.fn()
  const controller = new RuntimeRepositorySettingsController({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: update() reads only updateRepo from the store.
    getStore: () => ({ updateRepo }) as never,
    resolveRepo: async () => repo,
    forgetTerminalTopology: vi.fn(),
    invalidateResolvedWorktrees: vi.fn(),
    invalidateWorktreeScan: vi.fn(),
    notifyReposChanged
  })
  return { controller, updateRepo, notifyReposChanged }
}

describe('RuntimeRepositorySettingsController project map', () => {
  it('forwards a path to the store and notifies clients', async () => {
    const { controller, updateRepo, notifyReposChanged } = makeController()

    await controller.update('id:repo-1', { projectMapPath: MAP_PATH })

    expect(updateRepo).toHaveBeenCalledExactlyOnceWith('repo-1', { projectMapPath: MAP_PATH })
    expect(notifyReposChanged).toHaveBeenCalledOnce()
  })

  it('keeps the null sentinel so the store clears the map', async () => {
    const { controller, updateRepo } = makeController()

    await controller.update('id:repo-1', { projectMapPath: null })

    expect(updateRepo).toHaveBeenCalledExactlyOnceWith('repo-1', { projectMapPath: null })
  })
})
