import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, handlers } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.4.0-fork-test' },
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => handlers.delete(channel)
  },
  net: { fetch: fetchMock }
}))

import { registerFeedbackHandlers, submitFeedback } from '../../ipc/feedback'
import { resolveDiagnosticTokenEndpoint } from '../../observability/diagnostic-upload-endpoint'
import { _blockStockOrcaContactForTests, FEEDBACK_OFF_MESSAGE } from './no-phone-home'

const TURNED_OFF = { ok: false, status: null, error: FEEDBACK_OFF_MESSAGE }

describe('sending to Orca from this fork', () => {
  beforeEach(() => {
    handlers.clear()
    fetchMock.mockReset()
    _blockStockOrcaContactForTests(true)
  })

  afterEach(() => {
    _blockStockOrcaContactForTests(false)
    vi.unstubAllEnvs()
  })

  it('refuses sidebar feedback before anything leaves the machine', async () => {
    registerFeedbackHandlers()
    const send = handlers.get('feedback:submit')

    await expect(
      send?.(null, {
        feedback: 'hi',
        submitAnonymously: true,
        githubLogin: null,
        githubEmail: null
      })
    ).resolves.toEqual(TURNED_OFF)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a crash report with its log bundle', async () => {
    await expect(
      submitFeedback({
        feedback: '[Crash Report]',
        submissionType: 'crash',
        submitAnonymously: true,
        githubLogin: null,
        githubEmail: null,
        diagnosticBundle: {
          bundleSubmissionId: 'bundleabcdefghijklmnop',
          content: '{"type":"bundle-header"}\n',
          bytes: 25,
          spanCount: 1
        }
      })
    ).resolves.toEqual(TURNED_OFF)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('has no diagnostics upload endpoint, even when the env var names one', () => {
    vi.stubEnv('ORCA_DIAGNOSTICS_TOKEN_URL', 'https://diagnostics.example.test/token')

    expect(resolveDiagnosticTokenEndpoint()).toBeNull()
  })
})
