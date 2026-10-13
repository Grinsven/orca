import { basename } from '@/lib/path'
import setiIconMap from './seti-icon-map.json'

// Why Maps: a plain object lookup would resolve names like "constructor" to Object.prototype.
const FILE_NAMES = new Map(Object.entries(setiIconMap.fileNames))
const FILE_EXTENSIONS = new Map(Object.entries(setiIconMap.fileExtensions))
const LANGUAGE_FILE_NAMES = new Map(Object.entries(setiIconMap.languageFileNames))
const LANGUAGE_FILE_EXTENSIONS = new Map(Object.entries(setiIconMap.languageFileExtensions))

export const SETI_DEFAULT_ICON_ID = setiIconMap.defaultIcon

/** Longest first, so "d.ts" is tried before "ts", as VS Code does. */
function extensionCandidates(lowerName: string): string[] {
  const segments = lowerName.split('.')
  const candidates: string[] = []
  for (let index = 1; index < segments.length; index++) {
    const candidate = segments.slice(index).join('.')
    if (candidate) {
      candidates.push(candidate)
    }
  }
  return candidates
}

function findByExtension(table: Map<string, string>, extensions: string[]): string | undefined {
  for (const extension of extensions) {
    const iconId = table.get(extension)
    if (iconId) {
      return iconId
    }
  }
  return undefined
}

/** VS Code precedence: theme file names, theme extensions, then the file's language. */
export function getSetiFileIconId(filePath: string): string {
  const lowerName = basename(filePath).toLowerCase()
  if (!lowerName) {
    return SETI_DEFAULT_ICON_ID
  }
  const extensions = extensionCandidates(lowerName)
  return (
    FILE_NAMES.get(lowerName) ??
    findByExtension(FILE_EXTENSIONS, extensions) ??
    LANGUAGE_FILE_NAMES.get(lowerName) ??
    findByExtension(LANGUAGE_FILE_EXTENSIONS, extensions) ??
    SETI_DEFAULT_ICON_ID
  )
}
