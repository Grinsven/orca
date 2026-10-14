// Jose fork-local: regenerates the explorer's folder icons from the Material Icon Theme
// (https://github.com/material-extensions/vscode-material-icon-theme, MIT) at a pinned commit.
// Downloads are read as text data only, never executed, and every SVG is checked against an
// element and attribute allowlist before it is bundled.
//
// Usage: node config/scripts/generate-material-folder-icons.mjs <new empty download dir>
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SOURCE_REPO = 'material-extensions/vscode-material-icon-theme'
const SOURCE_TAG = 'v5.39.0'
const SOURCE_COMMIT = '92a9c5b25a5f4ae4c6a475fb99e434caffef5871'
const OUTPUT_DIR = 'src/renderer/src/fork/vscode-explorer'
const ICON_DIR_NAME = 'material-folder-icons'
const OPEN_SUFFIX = '-open'
// Material's default icon pack; some icons are only enabled for a given pack.
const ACTIVE_ICON_PACK_MEMBER = 'Angular'

// Trimmed set: folders that are common in JS/TS, mobile, docs and tooling repos.
const BUNDLED_ICONS = [
  'folder-android',
  'folder-api',
  'folder-app',
  'folder-claude',
  'folder-client',
  'folder-command',
  'folder-components',
  'folder-config',
  'folder-coverage',
  'folder-css',
  'folder-database',
  'folder-dist',
  'folder-docs',
  'folder-examples',
  'folder-git',
  'folder-github',
  'folder-helper',
  'folder-hook',
  'folder-husky',
  'folder-i18n',
  'folder-images',
  'folder-ios',
  'folder-lib',
  'folder-log',
  'folder-mobile',
  'folder-mock',
  'folder-node',
  'folder-packages',
  'folder-public',
  'folder-resource',
  'folder-scripts',
  'folder-server',
  'folder-shared',
  'folder-skills',
  'folder-src',
  'folder-store',
  'folder-temp',
  'folder-test',
  'folder-tools',
  'folder-typescript',
  'folder-utils',
  'folder-views',
  'folder-vscode'
]

const SAFE_ELEMENTS = new Set([
  'svg',
  'defs',
  'use',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'polygon'
])
// Attributes whose value must match, so nothing can point outside the file.
const PINNED_ATTRIBUTES = new Map([
  ['xmlns', /^http:\/\/www\.w3\.org\/2000\/svg$/],
  ['xmlns:xlink', /^http:\/\/www\.w3\.org\/1999\/xlink$/],
  ['href', /^#[\w-]+$/],
  ['xlink:href', /^#[\w-]+$/]
])
const SAFE_ATTRIBUTES = new Set([
  'viewBox',
  'id',
  'd',
  'fill',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'width',
  'height',
  'points',
  'transform'
])

async function download(downloadDir, repoPath) {
  const url = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_COMMIT}/${repoPath}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  const text = await response.text()
  const target = path.join(downloadDir, ...repoPath.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
  return text
}

function stringList(arrayBody) {
  if (arrayBody.replace(/'[^']*'/g, '').replace(/[\s,]/g, '') !== '') {
    throw new Error(`unexpected folder name list: [${arrayBody}]`)
  }
  return [...arrayBody.matchAll(/'([^']*)'/g)].map((match) => match[1])
}

/** Reads the 'specific' theme from folderIcons.ts as text; the file is prettier-formatted. */
function parseSpecificTheme(source) {
  const themeStart = source.indexOf("name: 'specific'")
  const iconsStart = source.indexOf('icons: [', themeStart)
  const themeEnd = source.indexOf("name: 'classic'", iconsStart)
  if (themeStart === -1 || iconsStart === -1 || themeEnd === -1) {
    throw new Error('unexpected folderIcons.ts layout')
  }
  const defaultIcon = source
    .slice(themeStart, iconsStart)
    .match(/defaultIcon:\s*\{\s*name:\s*'([^']+)'/)?.[1]
  const body = source.slice(iconsStart, themeEnd)
  const starts = [...body.matchAll(/\bname:\s*'([^']+)'/g)]
  const icons = starts.map((match, index) => {
    const chunk = body.slice(match.index, starts[index + 1]?.index ?? body.length)
    const folderNames = chunk.match(/(?<![\w])folderNames:\s*\[([^\]]*)\]/)?.[1]
    const enabledFor = chunk.match(/\benabledFor:\s*\[([^\]]*)\]/)?.[1]
    return {
      name: match[1],
      folderNames: folderNames === undefined ? [] : stringList(folderNames),
      enabledFor: enabledFor ? [...enabledFor.matchAll(/IconPack\.(\w+)/g)].map((m) => m[1]) : null,
      isClone: /\bclone:/.test(chunk),
      isDisabled: /\bdisabled:\s*true/.test(chunk),
      hasLightVariant: /\blight:\s*true/.test(chunk)
    }
  })
  return { defaultIcon, icons }
}

/** Folder name to icon, later icons winning, as Material's manifest merge does. */
function resolveWinningIcons(icons) {
  const winners = new Map()
  for (const icon of icons) {
    const enabled = !icon.enabledFor || icon.enabledFor.includes(ACTIVE_ICON_PACK_MEMBER)
    if (icon.isDisabled || !enabled) {
      continue
    }
    for (const folderName of icon.folderNames) {
      const lowerName = folderName.toLowerCase()
      // Why: the runtime strips ".", "_", "-" and "__x__" to find the base name.
      if (/^[._-]/.test(lowerName)) {
        throw new Error(`${icon.name}: folder name "${folderName}" starts with a variant prefix`)
      }
      winners.set(lowerName, icon)
    }
  }
  return winners
}

function extractConstant(source, pattern, label) {
  const value = source.match(pattern)?.[1]
  if (!value) {
    throw new Error(`could not find ${label}`)
  }
  return value
}

function assertSafeSvg(fileName, svg) {
  const rest = svg.replace(
    /<\/?([a-zA-Z]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*\/?>/g,
    (_tag, element, attributes) => {
      if (!SAFE_ELEMENTS.has(element)) {
        throw new Error(`${fileName}: element <${element}> is not allowed`)
      }
      for (const [, name, value] of attributes.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        const pinned = PINNED_ATTRIBUTES.get(name)
        const allowed = pinned ? pinned.test(value) : SAFE_ATTRIBUTES.has(name)
        if (!allowed || /url\(|script:|&/i.test(value)) {
          throw new Error(`${fileName}: attribute ${name}="${value}" is not allowed`)
        }
      }
      return ''
    }
  )
  if (rest.trim() !== '') {
    throw new Error(`${fileName}: unexpected content outside the allowed tags`)
  }
  if (!svg.includes('viewBox="0 0 16 16"')) {
    throw new Error(`${fileName}: expected a 16x16 viewBox`)
  }
}

/** Material builds open variants by swapping the d of the path with id="folder". */
function toOpenVariant(fileName, svg, openFolderPath) {
  let replaced = 0
  const open = svg.replace(/<path\b[^>]*\bid="folder"[^>]*>/g, (tag) => {
    replaced++
    return tag.replace(/\bd="[^"]*"/, `d="${openFolderPath}"`)
  })
  if (replaced !== 1) {
    throw new Error(`${fileName}: expected exactly one path with id="folder"`)
  }
  return open
}

async function main() {
  const [downloadDir] = process.argv.slice(2)
  if (!downloadDir) {
    throw new Error('usage: generate-material-folder-icons.mjs <new empty download dir>')
  }
  fs.mkdirSync(downloadDir, { recursive: true })
  if (fs.readdirSync(downloadDir).length > 0) {
    throw new Error(`${downloadDir} must be empty`)
  }

  const [folderIconsSource, folderGeneratorSource, defaultConfigSource, openIconsSource, license] =
    await Promise.all(
      [
        'src/core/icons/folderIcons.ts',
        'src/core/generator/folderGenerator.ts',
        'src/core/generator/config/defaultConfig.ts',
        'src/scripts/svg/generateOpenFolderIcons.ts',
        'LICENSE'
      ].map((repoPath) => download(downloadDir, repoPath))
    )

  const theme = parseSpecificTheme(folderIconsSource)
  const winners = resolveWinningIcons(theme.icons)
  const folderNames = {}
  for (const [folderName, icon] of [...winners].sort(([a], [b]) => a.localeCompare(b))) {
    // Why: names with a parent path ("github/workflows") need more than the row's own name.
    if (BUNDLED_ICONS.includes(icon.name) && !folderName.includes('/')) {
      folderNames[folderName] = icon.name
    }
  }
  for (const iconName of BUNDLED_ICONS) {
    const icon = theme.icons.find((candidate) => candidate.name === iconName)
    if (!icon || icon.isClone || icon.hasLightVariant) {
      throw new Error(`${iconName}: missing, a generated clone, or has a light variant`)
    }
    if (!Object.values(folderNames).includes(iconName)) {
      throw new Error(`${iconName}: wins no folder name, so it would never show`)
    }
  }

  const closedFolderPath = extractConstant(
    folderGeneratorSource,
    /const folderIcon =\s*'([^']+)'/,
    'the default folder path'
  )
  const defaultOpenFolderPath = extractConstant(
    folderGeneratorSource,
    /const folderIconOpen =\s*'([^']+)'/,
    'the default open folder path'
  )
  const openFolderPath = extractConstant(
    openIconsSource,
    /const OPEN_FOLDER_PATH =\s*'([^']+)'/,
    'the open folder path'
  )
  const defaultColor = extractConstant(
    defaultConfigSource,
    /const defaultColor = '(#[0-9a-fA-F]{6})'/,
    'the default folder color'
  )
  // Same markup as Material's getSVG(getPath(d, color)).
  const defaultSvg = (d) =>
    `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${defaultColor}" /></svg>`

  const svgs = new Map([
    [theme.defaultIcon, defaultSvg(closedFolderPath)],
    [`${theme.defaultIcon}${OPEN_SUFFIX}`, defaultSvg(defaultOpenFolderPath)]
  ])
  for (const iconName of BUNDLED_ICONS) {
    const svg = (await download(downloadDir, `icons/${iconName}.svg`)).trim()
    assertSafeSvg(`${iconName}.svg`, svg)
    svgs.set(iconName, svg)
    svgs.set(`${iconName}${OPEN_SUFFIX}`, toOpenVariant(`${iconName}.svg`, svg, openFolderPath))
  }

  const iconDir = path.join(OUTPUT_DIR, ICON_DIR_NAME)
  fs.rmSync(iconDir, { recursive: true, force: true })
  fs.mkdirSync(iconDir)
  const rules = []
  for (const [iconId, svg] of [...svgs].sort(([a], [b]) => a.localeCompare(b))) {
    assertSafeSvg(`${iconId}.svg`, svg)
    fs.writeFileSync(path.join(iconDir, `${iconId}.svg`), `${svg}\n`)
    rules.push(
      `[data-material-folder-icon='${iconId}'] {\n  background-image: url('./${ICON_DIR_NAME}/${iconId}.svg');\n}`
    )
  }

  const map = { defaultIcon: theme.defaultIcon, folderNames }
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'material-folder-icon-map.json'),
    `${JSON.stringify(map, null, 2)}\n`
  )
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'material-folder-icons.css'),
    `/* Generated by config/scripts/generate-material-folder-icons.mjs from the Material Icon Theme (MIT, see LICENSE-material-icon-theme.txt). Do not edit by hand. */\n${rules.join('\n')}\n`
  )
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'LICENSE-material-icon-theme.txt'),
    `${ICON_DIR_NAME}/*.svg and material-folder-icon-map.json come from the Material Icon Theme
(https://github.com/${SOURCE_REPO}, ${SOURCE_TAG}, commit
${SOURCE_COMMIT}), trimmed to ${BUNDLED_ICONS.length} folder icons plus the default
folder. The open variants and the default folder are built the way the theme's own build does
(src/scripts/svg/generateOpenFolderIcons.ts and src/core/generator/folderGenerator.ts). MIT
licensed.

---

${license.trim()}
`
  )
}

await main()
