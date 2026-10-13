import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getSetiFileIconId, SETI_DEFAULT_ICON_ID } from './seti-file-icon'
import setiIconMap from './seti-icon-map.json'

describe('getSetiFileIconId', () => {
  it('resolves common extensions through their VS Code language', () => {
    expect(getSetiFileIconId('src/index.ts')).toBe('typescript')
    expect(getSetiFileIconId('App.tsx')).toBe('react')
    expect(getSetiFileIconId('tsconfig.base.json')).toBe('json')
    expect(getSetiFileIconId('docs/guide.md')).toBe('markdown')
    expect(getSetiFileIconId('script.py')).toBe('python')
  })

  it('prefers an exact theme file name over the extension', () => {
    expect(getSetiFileIconId('README.md')).toBe('info')
    expect(getSetiFileIconId('docs/CHANGELOG.md')).toBe('clock')
  })

  it('matches names and extensions case-insensitively', () => {
    expect(getSetiFileIconId('NOTES.MD')).toBe('markdown')
    expect(getSetiFileIconId('ReadMe.MD')).toBe('info')
  })

  it('tries the longest compound extension first', () => {
    // Seti gives "spec.ts" its own test-file color, distinct from plain TypeScript.
    expect(getSetiFileIconId('component.spec.ts')).toBe('typescript_1')
    expect(getSetiFileIconId('component.ts')).toBe('typescript')
    expect(getSetiFileIconId('a.b.unknownext')).toBe(SETI_DEFAULT_ICON_ID)
  })

  it('handles Windows separators and dotfiles', () => {
    expect(getSetiFileIconId('C:\\repo\\src\\main.ts')).toBe('typescript')
    expect(getSetiFileIconId('.gitignore')).toBe('git')
  })

  it('falls back to the default icon for unknown or prototype-like names', () => {
    expect(getSetiFileIconId('LICENSE-unknown.zzz')).toBe(SETI_DEFAULT_ICON_ID)
    expect(getSetiFileIconId('constructor')).toBe(SETI_DEFAULT_ICON_ID)
    expect(getSetiFileIconId('file.__proto__')).toBe(SETI_DEFAULT_ICON_ID)
    expect(getSetiFileIconId('')).toBe(SETI_DEFAULT_ICON_ID)
  })

  it('has a glyph for every icon the map can return', () => {
    const iconIds = new Set([
      setiIconMap.defaultIcon,
      ...Object.values(setiIconMap.fileNames),
      ...Object.values(setiIconMap.fileExtensions),
      ...Object.values(setiIconMap.languageFileNames),
      ...Object.values(setiIconMap.languageFileExtensions)
    ])
    // Why fs: the test runner stubs CSS imports, even with ?raw.
    const glyphCss = readFileSync(new URL('./seti-icon-glyphs.css', import.meta.url), 'utf8')
    for (const iconId of iconIds) {
      const selector = `[data-seti-icon='${iconId}']::before {`
      expect(glyphCss).toContain(`\n${selector}\n  content: '\\E`)
    }
    expect(glyphCss).not.toContain('undefined')
  })
})
