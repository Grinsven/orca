import { isHtmlPreviewPath } from '../../shared/html-preview-path'
import type { RuntimeFileOpenPosition } from '../../shared/runtime-file-contracts'

/** Refuses before anything opens, so a preview request never lands as a source tab instead. */
export function assertRuntimeFilePreviewPath(relativePath: string): void {
  if (!isHtmlPreviewPath(relativePath)) {
    throw new Error(`Cannot preview ${relativePath}: only .html or .htm files render as a page.`)
  }
}

/** Why: a plain or positioned open must call the host with exactly the arguments it always did; a rendered page has no cursor, so preview drops the position. */
export function runtimeFileOpenTrailingArgs(
  position: RuntimeFileOpenPosition | undefined,
  preview: boolean | undefined
): [] | [RuntimeFileOpenPosition] | [undefined, true] {
  if (preview) {
    return [undefined, true]
  }
  return position ? [position] : []
}
