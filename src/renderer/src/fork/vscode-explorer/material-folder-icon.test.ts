import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getMaterialFolderIconId,
  MATERIAL_DEFAULT_FOLDER_ICON_ID,
  MATERIAL_OPEN_FOLDER_SUFFIX
} from './material-folder-icon'
import materialFolderIconMap from './material-folder-icon-map.json'

describe('getMaterialFolderIconId', () => {
  it('uses the default folder for names the theme does not list', () => {
    expect(MATERIAL_DEFAULT_FOLDER_ICON_ID).toBe('folder')
    expect(getMaterialFolderIconId('widgets-old', false)).toBe('folder')
    expect(getMaterialFolderIconId('widgets-old', true)).toBe('folder-open')
    expect(getMaterialFolderIconId('', false)).toBe('folder')
  })

  it('gives well-known folders their own icon', () => {
    expect(getMaterialFolderIconId('src', false)).toBe('folder-src')
    expect(getMaterialFolderIconId('tests', false)).toBe('folder-test')
    expect(getMaterialFolderIconId('spec', false)).toBe('folder-test')
    expect(getMaterialFolderIconId('docs', false)).toBe('folder-docs')
    expect(getMaterialFolderIconId('node_modules', false)).toBe('folder-node')
    expect(getMaterialFolderIconId('dist', false)).toBe('folder-dist')
    expect(getMaterialFolderIconId('out', false)).toBe('folder-dist')
    expect(getMaterialFolderIconId('components', false)).toBe('folder-components')
  })

  it('switches to the open variant when expanded', () => {
    expect(getMaterialFolderIconId('src', true)).toBe('folder-src-open')
    expect(getMaterialFolderIconId('docs', true)).toBe(`folder-docs${MATERIAL_OPEN_FOLDER_SUFFIX}`)
  })

  it('matches case-insensitively', () => {
    expect(getMaterialFolderIconId('SRC', false)).toBe('folder-src')
    expect(getMaterialFolderIconId('Docs', true)).toBe('folder-docs-open')
    expect(getMaterialFolderIconId('META-INF', false)).toBe('folder-config')
  })

  it('matches the dot, underscore, dash and dunder variants the theme generates', () => {
    expect(getMaterialFolderIconId('__tests__', false)).toBe('folder-test')
    expect(getMaterialFolderIconId('__mocks__', true)).toBe('folder-mock-open')
    expect(getMaterialFolderIconId('.github', false)).toBe('folder-github')
    expect(getMaterialFolderIconId('.vscode', false)).toBe('folder-vscode')
    expect(getMaterialFolderIconId('.claude', false)).toBe('folder-claude')
    expect(getMaterialFolderIconId('.git', false)).toBe('folder-git')
    expect(getMaterialFolderIconId('_lib', false)).toBe('folder-lib')
    expect(getMaterialFolderIconId('-config', false)).toBe('folder-config')
  })

  it('does not strip prefixes the theme never generates', () => {
    expect(getMaterialFolderIconId('__tests', false)).toBe('folder')
    expect(getMaterialFolderIconId('..src', false)).toBe('folder')
    expect(getMaterialFolderIconId('.__tests__', false)).toBe('folder')
    expect(getMaterialFolderIconId('____', false)).toBe('folder')
    expect(getMaterialFolderIconId('.', false)).toBe('folder')
  })

  it('ignores prototype-like names', () => {
    expect(getMaterialFolderIconId('constructor', false)).toBe('folder')
    expect(getMaterialFolderIconId('__proto__', true)).toBe('folder-open')
  })

  it('has a closed and open SVG and a CSS rule for every icon the map can return', () => {
    const iconIds = new Set([
      materialFolderIconMap.defaultIcon,
      ...Object.values(materialFolderIconMap.folderNames)
    ])
    // Why fs: the test runner stubs CSS imports, even with ?raw.
    const css = readFileSync(new URL('./material-folder-icons.css', import.meta.url), 'utf8')
    for (const iconId of iconIds) {
      for (const variant of [iconId, `${iconId}${MATERIAL_OPEN_FOLDER_SUFFIX}`]) {
        expect(existsSync(new URL(`./material-folder-icons/${variant}.svg`, import.meta.url))).toBe(
          true
        )
        expect(css).toContain(
          `[data-material-folder-icon='${variant}'] {\n  background-image: url('./material-folder-icons/${variant}.svg');\n}`
        )
      }
    }
  })
})
