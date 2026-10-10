import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RuntimeClientSettingsController } from '../../runtime-client-settings'
import { REPO_METHODS } from './repo'
import type { Repo } from '../../../../shared/repo-types'
import { getDefaultSettings } from '../../../../shared/constants'

const MAP_PATH = '/srv/repo/docs/project-map.html'

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'repo.update', params }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/srv/repo',
    displayName: 'repo',
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

function makeDispatcher(updated: Repo) {
  const runtime = new OrcaRuntimeService(null)
  const updateRepo = vi.spyOn(runtime, 'updateRepo').mockResolvedValue(updated)
  const clientSettings = new RuntimeClientSettingsController({
    getSettings: () => getDefaultSettings('/home/me'),
    updateSettings: vi.fn()
  })
  // Why: clients without the visibility capability get a projected copy built from these.
  vi.spyOn(runtime, 'getClientSettings').mockReturnValue(clientSettings.get())
  return { dispatcher: new RpcDispatcher({ runtime, methods: REPO_METHODS }), updateRepo }
}

describe('repo.update projectMapPath', () => {
  it('stores the trimmed path and returns it to clients without visibility capabilities', async () => {
    const { dispatcher, updateRepo } = makeDispatcher(makeRepo({ projectMapPath: MAP_PATH }))

    const response = await dispatcher.dispatch(
      makeRequest({ repo: 'id:repo-1', updates: { projectMapPath: `  ${MAP_PATH} ` } })
    )

    expect(updateRepo).toHaveBeenCalledExactlyOnceWith('id:repo-1', { projectMapPath: MAP_PATH })
    expect(response).toMatchObject({ ok: true, result: { repo: { projectMapPath: MAP_PATH } } })
  })

  it('passes the null sentinel through so the host clears the map', async () => {
    const { dispatcher, updateRepo } = makeDispatcher(makeRepo())

    const response = await dispatcher.dispatch(
      makeRequest({ repo: 'id:repo-1', updates: { projectMapPath: null } })
    )

    expect(updateRepo).toHaveBeenCalledExactlyOnceWith('id:repo-1', { projectMapPath: null })
    expect(response).toMatchObject({ ok: true })
  })

  it('leaves the field out when the caller does not send it', async () => {
    const { dispatcher, updateRepo } = makeDispatcher(makeRepo())

    await dispatcher.dispatch(
      makeRequest({ repo: 'id:repo-1', updates: { externalWorktreeVisibility: 'show' } })
    )

    expect(updateRepo).toHaveBeenCalledExactlyOnceWith('id:repo-1', {
      externalWorktreeVisibility: 'show'
    })
  })

  it.each(['docs/project-map.html', '/srv/repo/docs/project-map.md'])(
    'rejects %s without touching the repo',
    async (projectMapPath) => {
      const { dispatcher, updateRepo } = makeDispatcher(makeRepo())

      const response = await dispatcher.dispatch(
        makeRequest({ repo: 'id:repo-1', updates: { projectMapPath } })
      )

      expect(response).toMatchObject({
        ok: false,
        error: {
          code: 'invalid_argument',
          message: 'projectMapPath must be an absolute path to an .html or .htm file.'
        }
      })
      expect(updateRepo).not.toHaveBeenCalled()
    }
  )
})
