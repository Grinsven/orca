import type { PluginOptions } from 'babel-plugin-react-compiler'

export function rendererReactCompilerPlugins(): [string, PluginOptions][] {
  if (process.env.ORCA_REACT_COMPILER === '0') {
    return []
  }
  return [
    [
      'babel-plugin-react-compiler',
      {
        target: '19',
        compilationMode: 'infer',
        panicThreshold: 'none',
        // Compiler 1.0 incorrectly caches this hook's object literal, skipping its useRef calls.
        sources: (filename) =>
          !filename
            .replaceAll('\\', '/')
            .endsWith('/terminal-pane/use-terminal-pane-lifecycle-refs.ts'),
        logger:
          process.env.ORCA_REACT_COMPILER_DIAGNOSTICS === '1'
            ? {
                logEvent(filename, event) {
                  console.info('[react-compiler]', JSON.stringify({ filename, event }))
                }
              }
            : null
      }
    ]
  ]
}
