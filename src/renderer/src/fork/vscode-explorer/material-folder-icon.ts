import materialFolderIconMap from './material-folder-icon-map.json'

// Why a Map: a plain object lookup would resolve names like "constructor" to Object.prototype.
const FOLDER_NAMES = new Map(Object.entries(materialFolderIconMap.folderNames))

export const MATERIAL_DEFAULT_FOLDER_ICON_ID = materialFolderIconMap.defaultIcon
export const MATERIAL_OPEN_FOLDER_SUFFIX = '-open'

/** The theme also matches ".name", "_name", "-name" and "__name__" for every listed name. */
function variantBaseName(lowerName: string): string | undefined {
  if (lowerName.length > 4 && lowerName.startsWith('__') && lowerName.endsWith('__')) {
    return lowerName.slice(2, -2)
  }
  return /^[._-]./.test(lowerName) ? lowerName.slice(1) : undefined
}

/** Material Icon Theme folder icon id, with the "-open" variant for expanded folders. */
export function getMaterialFolderIconId(folderName: string, isExpanded: boolean): string {
  const lowerName = folderName.toLowerCase()
  const baseName = variantBaseName(lowerName)
  const iconId =
    FOLDER_NAMES.get(lowerName) ??
    (baseName === undefined ? undefined : FOLDER_NAMES.get(baseName)) ??
    MATERIAL_DEFAULT_FOLDER_ICON_ID
  return isExpanded ? `${iconId}${MATERIAL_OPEN_FOLDER_SUFFIX}` : iconId
}
