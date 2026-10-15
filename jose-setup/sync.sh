#!/bin/bash
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1; shift ;;
  --help|-h) printf 'Usage: bash jose-setup/sync.sh [--dry-run] (run inside the clone to sync)\n'; exit 0 ;;
esac
[ "$#" -eq 0 ] || { printf 'Unknown argument: %s\n' "$1" >&2; exit 2; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel)" || die 'Run inside the clone to sync.'
cd "$ROOT"
BRANCH="$(git symbolic-ref --quiet --short HEAD)" || die 'Detached HEAD; switch to main or jose/oled-ui.'
case "$BRANCH" in main|jose/oled-ui) ;; *) die "Branch $BRANCH is not main or jose/oled-ui." ;; esac
for state in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply sequencer; do
  [ ! -e "$(git rev-parse --git-path "$state")" ] || die "Finish the existing Git operation first: $state"
done
git remote get-url private >/dev/null || die 'The private remote is missing. Run setup --only checkout first.'
HEAD_BEFORE="$(git rev-parse HEAD)"
BASE_REF="refs/jose-setup/sync-base/$BRANCH"
BASE="$(git rev-parse --verify "$BASE_REF" 2>/dev/null || git rev-parse --verify refs/remotes/private/main 2>/dev/null || true)"
TRACKING=refs/remotes/private/main

report_local() {
  local target="${1:-}" args=(HEAD)
  [ -z "$BASE" ] || args+=("^$BASE")
  [ -z "$target" ] || args+=("^$target")
  LOCAL_COMMITS="$(git log --format='%H %s' "${args[@]}")"
  LOCAL_FILES="$(git status --short --untracked-files=all)"
  if [ -n "$LOCAL_FILES" ]; then printf 'Local files (Git status):\n%s\n' "$LOCAL_FILES"; fi
  if [ -n "$LOCAL_COMMITS" ]; then printf 'Commits outside known mirror history:\n%s\n' "$LOCAL_COMMITS"; fi
}

if [ "$DRY_RUN" -eq 1 ]; then
  printf '+ git fetch private +refs/heads/main:%s\n' "$TRACKING"
  REMOTE_LINE="$(git ls-remote --exit-code private refs/heads/main)" || die 'Cannot read private/main.'
  TARGET="${REMOTE_LINE%%[[:space:]]*}"
  if git cat-file -e "$TARGET^{commit}" 2>/dev/null; then
    report_local "$TARGET"
    [ -z "$LOCAL_FILES$LOCAL_COMMITS" ] || die 'Local work prevents resetting. Nothing changed.'
    printf 'Would back up HEAD %s, reset %s to %s, and save the mirror baseline.\n' "$HEAD_BEFORE" "$BRANCH" "$TARGET"
  else
    report_local
    printf 'Remote target %s is not available locally. Final comparison requires a fetch.\n' "$TARGET"
    printf 'Would reset only with a clean worktree and no commits outside known mirror history.\n'
  fi
  printf 'Dry run complete. No files or refs changed.\n'
  exit 0
fi

LOCK="$(git rev-parse --git-common-dir)/jose-setup-sync.lock"
mkdir "$LOCK" 2>/dev/null || die "Another sync may be running. Inspect $LOCK before removing a stale lock."
trap 'rmdir "$LOCK"' EXIT
if [ -n "$BASE" ] && ! git show-ref --verify --quiet "$BASE_REF"; then
  git update-ref "$BASE_REF" "$BASE"
fi
git fetch private "+refs/heads/main:$TRACKING"
TARGET="$(git rev-parse "$TRACKING^{commit}")"
report_local "$TARGET"
[ -z "$LOCAL_FILES$LOCAL_COMMITS" ] || die 'Local work prevents resetting. HEAD and working files were preserved.'
[ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || die 'Local work changed during sync; refusing to reset.'
MARKER="$ROOT/.orca-fork-base"
NEW_BASE=''
if [ -e "$MARKER" ] || [ -L "$MARKER" ]; then
  [ -f "$MARKER" ] && [ ! -L "$MARKER" ] || die '.orca-fork-base must be a regular file.'
  NEW_BASE="$(git describe --tags --first-parent --abbrev=0 --match 'v[0-9]*' "$TARGET")" || die 'Cannot determine the new upstream tag; HEAD was preserved.'
fi
if [ "$HEAD_BEFORE" != "$TARGET" ]; then
  # A replay can remove a path that this clone ignores but the new release tracks.
  while IFS= read -r -d '' ignored; do
    ignored="${ignored%/}"
    candidate="$ignored"
    while [ "$candidate" != . ]; do
      kind="$(git cat-file -t "$TARGET:$candidate" 2>/dev/null || true)"
      if [ -n "$kind" ] && { [ "$candidate" = "$ignored" ] || [ "$kind" != tree ]; }; then
        printf 'Ignored local file would be overwritten: %s (target path: %s)\n' "$ignored" "$candidate" >&2
        die 'Move this file aside before syncing.'
      fi
      candidate="$(dirname "$candidate")"
    done
  done < <(git ls-files --others --ignored --exclude-standard --directory -z)
  BACKUP="refs/jose-setup/sync-backups/$BRANCH/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  git update-ref "$BACKUP" "$HEAD_BEFORE"
  printf 'Saved previous HEAD: %s\n' "$BACKUP"
  git reset --hard "$TARGET"
else
  printf 'Already at private/main.\n'
fi
if [ -n "$NEW_BASE" ] && ! cmp -s "$MARKER" <(printf '%s\n' "$NEW_BASE"); then
  MARKER_BACKUP="$MARKER.backup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  cp -p "$MARKER" "$MARKER_BACKUP"
  printf '%s\n' "$NEW_BASE" > "$MARKER"
  printf 'Updated upstream base to %s; previous marker saved at %s.\n' "$NEW_BASE" "$MARKER_BACKUP"
fi
git update-ref "$BASE_REF" "$TARGET"
printf 'Synced %s to private/main (%s).\n' "$BRANCH" "$TARGET"
