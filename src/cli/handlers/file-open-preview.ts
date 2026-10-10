import { isHtmlPreviewPath } from '../../shared/html-preview-path'
import type { RuntimeFileOpenPosition } from '../../shared/runtime-file-contracts'
import type { RuntimeFileOpenResult } from '../../shared/runtime-types'
import { RuntimeClientError } from '../runtime-client'

// Why: a valued --preview (`--preview=x`) would otherwise open source silently.
export function getFileOpenPreviewFlag(flags: Map<string, string | boolean>): boolean {
  const value = flags.get('preview')
  if (typeof value === 'string') {
    throw new RuntimeClientError(
      'invalid_argument',
      `--preview takes no value, but got "${value}".`
    )
  }
  return value === true
}

/** Why before the RPC: a non-HTML --preview must fail without opening anything. */
export function assertFileOpenPreviewPath(path: string): void {
  if (!isHtmlPreviewPath(path)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Cannot preview ${path}: --preview renders only .html or .htm files.`
    )
  }
}

// Why: a rendered page has no cursor, so a position would be silently dropped.
export function assertFileOpenPreviewWithoutPosition(
  position: RuntimeFileOpenPosition | undefined
): void {
  if (position) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--preview cannot be combined with --line or --column.'
    )
  }
}

// Why: an older host strips the unknown param and opens source, so only its echo proves a preview.
export function requireFilePreviewOpened(result: RuntimeFileOpenResult, target: string): void {
  if (result.preview !== true) {
    throw new RuntimeClientError(
      'preview_unsupported',
      `This Orca host does not support --preview, so ${target} opened as source. Update Orca to render it as a page.`,
      { nextSteps: ['Update the Orca app, then run the command again.'] }
    )
  }
}

export function formatFilePreviewOpen(result: RuntimeFileOpenResult): string {
  return `Opened preview of ${result.relativePath}.`
}
