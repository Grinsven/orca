import { afterEach, describe, expect, it, vi } from 'vitest'
import { rendererReactCompilerPlugins } from '../build-plugins/renderer-react-compiler'

afterEach(() => vi.unstubAllEnvs())

describe('renderer React Compiler', () => {
  it('enables React 19 compilation without failing builds on skipped components', () => {
    vi.stubEnv('ORCA_REACT_COMPILER', undefined)
    vi.stubEnv('ORCA_REACT_COMPILER_DIAGNOSTICS', undefined)

    expect(rendererReactCompilerPlugins()).toEqual([
      [
        'babel-plugin-react-compiler',
        {
          target: '19',
          compilationMode: 'infer',
          panicThreshold: 'none',
          logger: null,
          sources: expect.any(Function)
        }
      ]
    ])
  })

  it.each(['/', '\\'])('excludes the mutable pane registry with %s paths', (separator) => {
    vi.stubEnv('ORCA_REACT_COMPILER', '1')
    const sources = rendererReactCompilerPlugins()[0]?.[1].sources
    if (typeof sources !== 'function') {
      throw new Error('Expected compiler source filter')
    }

    expect([
      sources(['root', 'terminal-pane', 'use-terminal-pane-lifecycle-refs.ts'].join(separator)),
      sources(['root', 'terminal-pane', 'use-terminal-pane.ts'].join(separator))
    ]).toEqual([false, true])
  })

  it('supports a build-time opt-out for comparisons and rollback', () => {
    vi.stubEnv('ORCA_REACT_COMPILER', '0')

    expect(rendererReactCompilerPlugins()).toEqual([])
  })

  it('provides compiler diagnostics only when requested', () => {
    vi.stubEnv('ORCA_REACT_COMPILER', '1')
    vi.stubEnv('ORCA_REACT_COMPILER_DIAGNOSTICS', '1')

    expect(rendererReactCompilerPlugins()[0]?.[1].logger).toEqual({
      logEvent: expect.any(Function)
    })
  })
})
