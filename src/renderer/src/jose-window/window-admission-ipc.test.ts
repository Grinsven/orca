import { expect, it } from 'vitest'
import { setupTerminalCreateSurfacing } from '../hooks/ipc-events-terminal-create-test-harness'

it('blocks native new-terminal IPC while the selected visible workspace awaits ownership', async () => {
  const scenario = await setupTerminalCreateSurfacing(() => false)
  const { bindWindowWorkspaceAdmission } = await import('./window-workspace-admission')
  const gate = bindWindowWorkspaceAdmission(() => [
    { ref: { worktreeId: 'wt-1', executionHostId: 'local' }, status: 'pending' }
  ])
  try {
    scenario.newTerminalTabListenerRef.current?.()
    await Promise.resolve()
    expect({
      remote: scenario.createWebRuntimeSessionTerminal.mock.calls.length,
      local: scenario.createTab.mock.calls.length
    }).toEqual({ remote: 0, local: 0 })
  } finally {
    gate.stop()
  }
})
