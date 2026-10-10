import { z } from 'zod'
import { isRuntimePathAbsolute } from './cross-platform-path'
import { isHtmlPreviewPath } from './html-preview-path'

export const REPO_PROJECT_MAP_PATH_REQUIREMENT = 'must be an absolute path to an .html or .htm file'

/** Trimmed path when it is an absolute .html/.htm path on a POSIX or Windows host, else null. */
export function normalizeRepoProjectMapPath(value: string): string | null {
  const trimmed = value.trim()
  return trimmed && isRuntimePathAbsolute(trimmed) && isHtmlPreviewPath(trimmed) ? trimmed : null
}

// Why: null clears the map; a malformed path fails the call instead of being stored.
export const RepoProjectMapPathUpdate = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizeRepoProjectMapPath(value)
    if (normalized === null) {
      ctx.addIssue({
        code: 'custom',
        message: `projectMapPath ${REPO_PROJECT_MAP_PATH_REQUIREMENT}.`
      })
      return z.NEVER
    }
    return normalized
  })
  .nullable()
  .optional()
