/** True for paths Orca can render as a page (`orca file open --preview`, the project map). */
export function isHtmlPreviewPath(filePath: string): boolean {
  return /\.html?$/i.test(filePath)
}
