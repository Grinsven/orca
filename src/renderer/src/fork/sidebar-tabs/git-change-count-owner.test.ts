import { beforeEach, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/store-test-helpers'
import { createCompatibleRuntimeStatusResponse } from '@/runtime/runtime-compatibility-test-fixture'
import type { RuntimeEnvironmentStatus } from '../../../../shared/runtime-host-status'
import { activeGitCountContext } from './git-change-count-owner'
import { createGitChangeCountPublisher, useGitChangeCounts } from './use-git-change-count'
import { gitChangeCountKey } from './git-change-count'

const id = 'repo::/work'
const local = { worktreeId: id, worktreePath: '/work', target: { kind: 'local' as const } }
const remote = { ...local, target: { kind: 'environment' as const, environmentId: 'server' } }
const changed = {
  entries: [{ path: 'edit.ts', status: 'modified' as const, area: 'unstaged' as const }],
  conflictOperation: 'unknown' as const
}

function connected(): RuntimeEnvironmentStatus {
  const response = createCompatibleRuntimeStatusResponse('server')
  if (!response.ok) {
    throw new Error('Expected runtime fixture')
  }
  return { status: response.result, checkedAt: 1, connectionGeneration: 7 }
}

beforeEach(() => {
  useAppStore.setState({
    activeWorktreeId: null,
    gitStatusByWorktree: {},
    runtimeStatusByEnvironmentId: new Map([['server', connected()]]),
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map()
  })
  useGitChangeCounts.setState({ snapshots: new Map() })
})

it('retains independent accepted counts for identical worktree IDs on two owners', () => {
  createGitChangeCountPublisher(local)(changed)
  createGitChangeCountPublisher(remote)({ ...changed, entries: [] })
  expect([
    useGitChangeCounts.getState().snapshots.get(gitChangeCountKey(local))?.count,
    useGitChangeCounts.getState().snapshots.get(gitChangeCountKey(remote))?.count
  ]).toEqual([1, 0])
})

it('invalidates an inactive host count and its late response across a contact loss', () => {
  const publish = createGitChangeCountPublisher(remote)
  publish(changed)
  useAppStore.setState({
    runtimeStatusByEnvironmentId: new Map([
      ['server', { status: null, checkedAt: 2, connectionGeneration: 7 }]
    ])
  })
  useAppStore.setState({ runtimeStatusByEnvironmentId: new Map([['server', connected()]]) })
  publish(changed)
  expect(useGitChangeCounts.getState().snapshots.has(gitChangeCountKey(remote))).toBe(false)
})

it('accepts a fresh refresh after reconnect without another badge request', () => {
  createGitChangeCountPublisher(remote)(changed)
  useAppStore.setState({ runtimeStatusByEnvironmentId: new Map() })
  useAppStore.setState({ runtimeStatusByEnvironmentId: new Map([['server', connected()]]) })
  createGitChangeCountPublisher(remote)(changed)
  expect(useGitChangeCounts.getState().snapshots.get(gitChangeCountKey(remote))?.count).toBe(1)
})

it('drops counts when existing status is purged for a deleted workspace', () => {
  useAppStore.setState({ gitStatusByWorktree: { [id]: changed.entries } })
  const publish = createGitChangeCountPublisher(local)
  publish(changed)
  useAppStore.setState({ gitStatusByWorktree: {} })
  publish(changed)
  expect(useGitChangeCounts.getState().snapshots.has(gitChangeCountKey(local))).toBe(false)
})

it('resolves duplicate SSH worktree IDs on the selected host', () => {
  useAppStore.setState({
    activeWorktreeId: id,
    activeWorkspaceExecutionHostId: 'ssh:two',
    repos: ['one', 'two'].map((connectionId) => ({
      id: 'repo',
      path: '/work',
      displayName: 'repo',
      badgeColor: '',
      addedAt: 0,
      connectionId,
      executionHostId: `ssh:${connectionId}`
    })),
    worktreesByRepo: {
      repo: ['one', 'two'].map((connectionId) =>
        makeWorktree({ id, repoId: 'repo', path: '/work', hostId: `ssh:${connectionId}` })
      )
    }
  })
  expect(activeGitCountContext(useAppStore.getState())?.connectionId).toBe('two')
})

it('never derives a badge for a non-git folder workspace', () => {
  useAppStore.setState({ activeWorktreeId: 'folder:plain' })
  expect(activeGitCountContext(useAppStore.getState())).toBeNull()
})

it('withdraws direct SSH counts until a new connected request is accepted', () => {
  const ssh = { ...local, connectionId: 'target' }
  const connection = {
    targetId: 'target',
    status: 'connected' as const,
    error: null,
    reconnectAttempt: 0,
    connectionGeneration: 1
  }
  useAppStore.setState({ sshConnectionStates: new Map([['target', connection]]) })
  const late = createGitChangeCountPublisher(ssh)
  late(changed)
  useAppStore.setState({
    sshConnectionStates: new Map([['target', { ...connection, status: 'disconnected' }]])
  })
  useAppStore.setState({ sshConnectionStates: new Map([['target', connection]]) })
  late(changed)
  expect(useGitChangeCounts.getState().snapshots.has(gitChangeCountKey(ssh))).toBe(false)
})

it('bounds retained counts when many workspaces are visited', () => {
  for (let index = 0; index < 140; index++) {
    createGitChangeCountPublisher({
      ...local,
      worktreeId: `repo::/work-${index}`,
      worktreePath: `/work-${index}`
    })(changed)
  }
  expect(useGitChangeCounts.getState().snapshots.size).toBeLessThanOrEqual(128)
})
