import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { activeOwnershipRef, resolveOwnershipRef, viewExecutionHostId } from './ownership-ref'

const HOST: RuntimeClientTarget = { kind: 'local' }
const WINDOW_2: RuntimeClientTarget = { kind: 'environment', environmentId: 'main-env' }

function row(hostId: ExecutionHostId) {
  return { id: 'repo-1::a', repoId: 'repo-1', hostId }
}

const state = {
  repos: [{ id: 'repo-1', connectionId: null }],
  worktreesByRepo: {
    'repo-1': [row('local'), row('ssh:box'), row('runtime:main-env'), row('runtime:hub-b')]
  }
}

describe('resolveOwnershipRef', () => {
  it('names a workspace the way the ownership host does, per host', () => {
    expect({
      hostLocal: resolveOwnershipRef(state, HOST, 'repo-1::a', 'local'),
      hostSsh: resolveOwnershipRef(state, HOST, 'repo-1::a', 'ssh:box'),
      window2HostCheckout: resolveOwnershipRef(state, WINDOW_2, 'repo-1::a', 'runtime:main-env')
    }).toEqual({
      hostLocal: { worktreeId: 'repo-1::a', executionHostId: 'local' },
      hostSsh: { worktreeId: 'repo-1::a', executionHostId: 'ssh:box' },
      window2HostCheckout: { worktreeId: 'repo-1::a', executionHostId: 'local' }
    })
  })

  it('shares nothing for a same-id workspace on a host the ownership host does not serve', () => {
    expect({
      host: resolveOwnershipRef(state, HOST, 'repo-1::a', 'runtime:hub-b'),
      window2Local: resolveOwnershipRef(state, WINDOW_2, 'repo-1::a', 'local'),
      window2Other: resolveOwnershipRef(state, WINDOW_2, 'repo-1::a', 'runtime:hub-b')
    }).toEqual({ host: null, window2Local: null, window2Other: null })
  })

  it('reads the active workspace with its selected host', () => {
    expect(
      activeOwnershipRef(
        {
          ...state,
          activeWorktreeId: 'repo-1::a',
          activeWorkspaceExecutionHostId: 'runtime:hub-b'
        },
        HOST
      )
    ).toBeNull()
  })
})

describe('viewExecutionHostId', () => {
  it('maps the host own checkouts back to window 2 runtime host', () => {
    const ref = { worktreeId: 'repo-1::a', executionHostId: 'local' }
    expect([viewExecutionHostId(ref, WINDOW_2), viewExecutionHostId(ref, HOST)]).toEqual([
      'runtime:main-env',
      'local'
    ])
  })
})
