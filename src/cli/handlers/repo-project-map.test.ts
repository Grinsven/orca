import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../args'
import { dispatch } from '../dispatch'
import { RuntimeClient } from '../runtime-client'
import { CORE_COMMAND_SPECS } from '../specs/core'

const MAP_PATH = '/srv/repo/docs/project-map.html'

describe('repo set --project-map', () => {
  const client = new RuntimeClient('/tmp/orca-project-map-test', 60_000, null, null)

  function replyWith(repo: Record<string, unknown>) {
    return {
      id: 'repo-update',
      ok: true as const,
      result: { repo: { id: 'repo-1', path: '/srv/repo', ...repo } },
      _meta: { runtimeId: 'test-runtime' }
    }
  }

  function run(args: string[], json = true) {
    const parsed = parseArgs(args)
    validateCommandAndFlags(CORE_COMMAND_SPECS, parsed)
    return dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/tmp', json })
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([MAP_PATH, String.raw`C:\Repos\My repo\Map.HTM`])(
    'sends %s as projectMapPath',
    async (mapPath) => {
      vi.spyOn(client, 'call').mockResolvedValue(replyWith({ projectMapPath: mapPath }))

      await run(['repo', 'set', '--repo', 'id:repo-1', '--project-map', mapPath, '--json'])

      expect(client.call).toHaveBeenCalledExactlyOnceWith('repo.update', {
        repo: 'id:repo-1',
        updates: { projectMapPath: mapPath }
      })
    }
  )

  it('clears the map with the literal null', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(replyWith({}))

    await run(['repo', 'set', '--repo', 'id:repo-1', '--project-map', 'null', '--json'])

    expect(client.call).toHaveBeenCalledExactlyOnceWith('repo.update', {
      repo: 'id:repo-1',
      updates: { projectMapPath: null }
    })
  })

  it('sends both settings in one repo.update', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(
      replyWith({ externalWorktreeVisibility: 'hide', projectMapPath: MAP_PATH })
    )

    await run([
      'repo',
      'set',
      '--repo',
      'id:repo-1',
      '--external-worktree-visibility',
      'hide',
      '--project-map',
      MAP_PATH,
      '--json'
    ])

    expect(client.call).toHaveBeenCalledExactlyOnceWith('repo.update', {
      repo: 'id:repo-1',
      updates: { externalWorktreeVisibility: 'hide', projectMapPath: MAP_PATH }
    })
  })

  it.each([
    { args: [], message: 'repo set needs --external-worktree-visibility, --project-map, or both.' },
    {
      args: ['--project-map', 'docs/project-map.html'],
      message:
        '--project-map must be an absolute path to an .html or .htm file: docs/project-map.html'
    },
    {
      args: ['--project-map', '/srv/repo/docs/project-map.md'],
      message:
        '--project-map must be an absolute path to an .html or .htm file: /srv/repo/docs/project-map.md'
    },
    { args: ['--project-map'], message: '--project-map requires a value' }
  ])('rejects $args before calling the runtime', async ({ args, message }) => {
    vi.spyOn(client, 'call')

    await expect(run(['repo', 'set', '--repo', 'id:repo-1', ...args])).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining(message)
    })
    expect(client.call).not.toHaveBeenCalled()
  })

  it('fails when an older host drops the unknown field and answers without it', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(replyWith({}))

    await expect(
      run(['repo', 'set', '--repo', 'id:repo-1', '--project-map', MAP_PATH, '--json'])
    ).rejects.toMatchObject({
      code: 'incompatible_runtime',
      message: 'This Orca host does not support --project-map, update Orca.'
    })
    expect(client.call).toHaveBeenCalledOnce()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('prints projectMapPath in repo show', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(replyWith({ projectMapPath: MAP_PATH }))

    await run(['repo', 'show', '--repo', 'id:repo-1'], false)

    expect(console.log).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`projectMapPath: ${MAP_PATH}`)
    )
  })
})
