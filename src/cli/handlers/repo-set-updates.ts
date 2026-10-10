import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime/types'
import {
  normalizeRepoProjectMapPath,
  REPO_PROJECT_MAP_PATH_REQUIREMENT
} from '../../shared/repo-project-map-path'

export type RepoSetUpdates = {
  externalWorktreeVisibility?: 'show' | 'hide' | null
  projectMapPath?: string | null
}

/** Builds the one repo.update patch `orca repo set` sends; throws before any RPC on bad flags. */
export function readRepoSetUpdates(flags: Map<string, string | boolean>): RepoSetUpdates {
  const visibility = getOptionalStringFlag(flags, 'external-worktree-visibility')
  const projectMap = getOptionalStringFlag(flags, 'project-map')
  if (visibility === undefined && projectMap === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      'repo set needs --external-worktree-visibility, --project-map, or both.'
    )
  }
  const updates: RepoSetUpdates = {}
  if (visibility !== undefined) {
    if (visibility !== 'show' && visibility !== 'hide' && visibility !== 'inherit') {
      throw new RuntimeClientError(
        'invalid_argument',
        '--external-worktree-visibility must be show, hide, or inherit.'
      )
    }
    updates.externalWorktreeVisibility = visibility === 'inherit' ? null : visibility
  }
  if (projectMap !== undefined) {
    updates.projectMapPath = projectMap === 'null' ? null : requireProjectMapPath(projectMap)
  }
  return updates
}

function requireProjectMapPath(value: string): string {
  const normalized = normalizeRepoProjectMapPath(value)
  if (normalized === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--project-map ${REPO_PROJECT_MAP_PATH_REQUIREMENT}: ${value}`
    )
  }
  return normalized
}

/** Old hosts strip the unknown field and still answer ok, so the echo is the only proof. */
export function assertRepoProjectMapApplied(
  updates: RepoSetUpdates,
  repo: Record<string, unknown>
): void {
  if (
    typeof updates.projectMapPath === 'string' &&
    repo.projectMapPath !== updates.projectMapPath
  ) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host does not support --project-map, update Orca.'
    )
  }
}
