import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { hydrateRepo } from './repo-hydration'
import { RepoUpdatePersistenceOperations } from './repo-update-operations'

const MAP_PATH = '/srv/repo/docs/project-map.html'

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/srv/repo',
    displayName: 'Repo',
    badgeColor: '#000000',
    addedAt: 0,
    kind: 'git',
    ...overrides
  }
}

function makeOperations(repo: Repo) {
  const scheduleSave = vi.fn()
  const operations = new RepoUpdatePersistenceOperations({
    state: { repos: [repo], projectGroups: [] },
    bumpLocalWorktreeScanGeneration: vi.fn(),
    syncProjectHostSetupCompatibilityState: vi.fn(),
    scheduleSave,
    hydrateRepo: (row) => hydrateRepo(row, new Map())
  })
  return { operations, scheduleSave }
}

describe('updateRepo projectMapPath', () => {
  it('persists a new path on the stored row and returns it hydrated', () => {
    const repo = makeRepo()
    const { operations, scheduleSave } = makeOperations(repo)

    const updated = operations.updateRepo('repo-1', { projectMapPath: MAP_PATH })

    expect(repo.projectMapPath).toBe(MAP_PATH)
    expect(updated?.projectMapPath).toBe(MAP_PATH)
    expect(scheduleSave).toHaveBeenCalledOnce()
  })

  it('deletes the stored path on null instead of persisting null', () => {
    const repo = makeRepo({ projectMapPath: MAP_PATH })
    const { operations } = makeOperations(repo)

    const updated = operations.updateRepo('repo-1', { projectMapPath: null })

    expect('projectMapPath' in repo).toBe(false)
    expect(updated && 'projectMapPath' in updated).toBe(false)
  })

  it('keeps the stored path when an unrelated field changes', () => {
    const repo = makeRepo({ projectMapPath: MAP_PATH })
    const { operations } = makeOperations(repo)

    operations.updateRepo('repo-1', { displayName: 'Renamed' })

    expect(repo.projectMapPath).toBe(MAP_PATH)
  })

  it('survives hydration of a persisted row', () => {
    expect(hydrateRepo(makeRepo({ projectMapPath: MAP_PATH }), new Map()).projectMapPath).toBe(
      MAP_PATH
    )
  })
})
