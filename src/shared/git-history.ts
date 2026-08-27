import {
  GIT_HISTORY_COMMIT_FORMAT,
  gitHistoryRefFromFullName,
  parseGitHistoryLog,
  shortGitHash
} from './git-history-log-parser'
import {
  GIT_HISTORY_DEFAULT_LIMIT,
  GIT_HISTORY_MAX_LIMIT,
  normalizeGitHistoryScope,
  type GitHistoryExecutor,
  type GitHistoryItemRef,
  type GitHistoryOptions,
  type GitHistoryResult
} from './git-history-types'

export type {
  GitHistoryExecutor,
  GitHistoryGraphColorId,
  GitHistoryItem,
  GitHistoryItemRef,
  GitHistoryItemStatistics,
  GitHistoryOptions,
  GitHistoryRefCategory,
  GitHistoryResult,
  GitHistoryScope
} from './git-history-types'
export {
  GIT_HISTORY_BASE_REF_COLOR,
  GIT_HISTORY_DEFAULT_LIMIT,
  GIT_HISTORY_DEFAULT_SCOPE,
  GIT_HISTORY_LANE_COLORS,
  GIT_HISTORY_MAX_LIMIT,
  GIT_HISTORY_PANEL_DEFAULT_HEIGHT,
  GIT_HISTORY_PANEL_MAX_HEIGHT,
  GIT_HISTORY_PANEL_MIN_HEIGHT,
  GIT_HISTORY_REF_COLOR,
  GIT_HISTORY_REMOTE_REF_COLOR,
  normalizeGitHistoryPanelHeight,
  normalizeGitHistoryScope
} from './git-history-types'
export { compareGitHistoryItemRefsByCategory, parseGitHistoryLog } from './git-history-log-parser'

function clampHistoryLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return GIT_HISTORY_DEFAULT_LIMIT
  }
  return Math.min(
    GIT_HISTORY_MAX_LIMIT,
    Math.max(1, Math.trunc(limit ?? GIT_HISTORY_DEFAULT_LIMIT))
  )
}

async function resolveCommit(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string
): Promise<string | null> {
  if (!ref || ref.startsWith('-')) {
    return null
  }
  try {
    const { stdout } = await git(
      ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
      cwd
    )
    const oid = stdout.trim()
    return oid || null
  } catch {
    return null
  }
}

async function resolveSymbolicFullName(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string
): Promise<string | null> {
  if (!ref || ref.startsWith('-')) {
    return null
  }
  try {
    const { stdout } = await git(
      ['rev-parse', '--symbolic-full-name', '--end-of-options', ref],
      cwd
    )
    // Why skip the marker: --verify swallows --end-of-options, but
    // --symbolic-full-name deliberately echoes it, so the first line is the marker
    // rather than the ref. Taking it made every branch and tag fall through
    // gitHistoryRefFromFullName's prefix checks into the "commits" category.
    return (
      stdout
        .trim()
        .split(/\r?\n/)
        .find((line) => line && line !== '--end-of-options') ?? null
    )
  } catch {
    return null
  }
}

async function resolveCurrentRef(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string
): Promise<{ currentRef: GitHistoryItemRef; branchName: string | null }> {
  try {
    const { stdout } = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)
    const branchName = stdout.trim()
    if (branchName) {
      return {
        branchName,
        currentRef: {
          id: `refs/heads/${branchName}`,
          name: branchName,
          revision: headOid,
          category: 'branches'
        }
      }
    }
  } catch {
    // Detached HEAD.
  }

  return {
    branchName: null,
    currentRef: { id: headOid, name: shortGitHash(headOid), revision: headOid, category: 'commits' }
  }
}

async function resolveUpstreamRef(
  git: GitHistoryExecutor,
  cwd: string,
  branchName: string | null
): Promise<GitHistoryItemRef | undefined> {
  if (!branchName) {
    return undefined
  }
  try {
    const { stdout } = await git(
      ['for-each-ref', '--format=%(upstream)%00%(upstream:short)', `refs/heads/${branchName}`],
      cwd
    )
    const [fullName, shortName] = stdout.split('\0')
    const upstreamRef = fullName?.trim()
    const upstreamShortName = shortName?.trim()
    if (!upstreamRef || !upstreamShortName) {
      return undefined
    }
    // Why: %(upstream:objectname) is not portable across Git versions; resolve
    // the upstream name first, then ask rev-parse for the commit object.
    const oid = await resolveCommit(git, cwd, upstreamRef)
    return oid ? gitHistoryRefFromFullName(upstreamRef, upstreamShortName, oid) : undefined
  } catch {
    return undefined
  }
}

async function resolveNamedRef(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string | null | undefined
): Promise<GitHistoryItemRef | undefined> {
  const normalized = ref?.trim()
  if (!normalized || normalized.startsWith('-')) {
    return undefined
  }
  const [revision, fullName] = await Promise.all([
    resolveCommit(git, cwd, normalized),
    resolveSymbolicFullName(git, cwd, normalized)
  ])
  return revision ? gitHistoryRefFromFullName(fullName, normalized, revision) : undefined
}

export async function loadGitHistoryFromExecutor(
  git: GitHistoryExecutor,
  cwd: string,
  options: GitHistoryOptions = {}
): Promise<GitHistoryResult> {
  const limit = clampHistoryLimit(options.limit)
  const scope = normalizeGitHistoryScope(options.scope)
  const headOid = await resolveCommit(git, cwd, 'HEAD')
  // Why the scope check: an unborn HEAD leaves the branch scope with nothing to walk, but the
  // all-branches graph draws every other ref and does not need HEAD to exist.
  if (!headOid && scope !== 'all') {
    return {
      items: [],
      hasIncomingChanges: false,
      hasOutgoingChanges: false,
      hasMore: false,
      limit
    }
  }

  const { currentRef, branchName } = headOid
    ? await resolveCurrentRef(git, cwd, headOid)
    : { currentRef: undefined, branchName: null }
  const [remoteRef, rawBaseRef] = await Promise.all([
    resolveUpstreamRef(git, cwd, branchName),
    resolveNamedRef(git, cwd, options.baseRef)
  ])

  const baseRef =
    rawBaseRef && rawBaseRef.id !== remoteRef?.id && rawBaseRef.id !== currentRef?.id
      ? rawBaseRef
      : undefined

  // Why 'branch' is the default: scoping to the workspace HEAD keeps an old workspace from
  // listing newly fetched upstream/base commits. Upstream and base refs stay comparison
  // metadata in both scopes. 'all' is the explicit opt-in that graphs every ref.
  // Why not --all: it also walks refs/stash and refs/notes/*, so the graph would list git
  // plumbing commits (the stash entry even opens a second lane) that carry no decoration.
  // headOid rides along so a detached HEAD, which no ref covers, still appears.
  const headRevisions = headOid ? [headOid] : []
  const historyRevisions =
    scope === 'all' ? ['--branches', '--remotes', '--tags', ...headRevisions] : headRevisions

  let mergeBase: string | undefined
  if (remoteRef?.revision && currentRef?.revision && remoteRef.revision !== currentRef.revision) {
    try {
      const { stdout } = await git(['merge-base', currentRef.revision, remoteRef.revision], cwd)
      mergeBase = stdout.trim() || undefined
    } catch {
      mergeBase = undefined
    }
  }

  const { stdout } = await git(
    [
      'log',
      '--no-show-signature',
      '--no-color',
      `--format=${GIT_HISTORY_COMMIT_FORMAT}`,
      '-z',
      '--topo-order',
      '--decorate=full',
      `-n${limit + 1}`,
      ...historyRevisions
    ],
    cwd
  )
  const parsed = parseGitHistoryLog(stdout)
  const items = parsed.slice(0, limit)
  // Why gated on scope: the boundary rows stand in for upstream commits that HEAD-only history
  // omits. The all-branches walk lists those commits for real, so the pseudo-rows would sit
  // right next to the commits they represent.
  const drawsBoundaryRows = scope !== 'all'
  const hasIncomingChanges =
    drawsBoundaryRows &&
    Boolean(remoteRef?.revision && mergeBase) &&
    remoteRef?.revision !== mergeBase
  const hasOutgoingChanges =
    drawsBoundaryRows &&
    Boolean(currentRef?.revision && remoteRef?.revision && mergeBase) &&
    currentRef?.revision !== mergeBase

  return {
    items,
    currentRef,
    remoteRef,
    baseRef,
    mergeBase,
    hasIncomingChanges,
    hasOutgoingChanges,
    hasMore: parsed.length > limit,
    limit
  }
}
