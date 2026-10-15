#!/bin/bash
set -euo pipefail

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(cd "$SETUP_DIR/.." && pwd)"
CHECKOUT="$HOME/Projects/orca"
UPSTREAM=https://github.com/stablyai/orca
PRIVATE=https://github.com/Grinsven/orca-patched.git
BRANCH=jose/oled-ui
SIGN_ID='Orca Patched Signing'
APP='/Applications/Orca Patched.app'
PLIST="$HOME/Library/LaunchAgents/nl.josetorres.orca-fork-update.plist"
DRY_RUN=0
INSTALL=0
NO_LOAD=0
SKIP_BUILD=0
ONLY=all

usage() {
  cat <<'EOF'
Usage: bash jose-setup/setup.sh [--install] [--dry-run] [--skip-build]
       [--only STEP[,STEP...]] [--no-load]
Steps: prerequisites,checkout,signing,deps,build,fonts,settings,app,cli,skills,updater,launchd
Default: all steps. --install authorizes signing, app installation and launchd loading.
File-only example: --only skills,updater,launchd --no-load
--dry-run prints the plan without downloads, authentication calls or writes.
--skip-build reuses dist/mac-arm64/Orca.app; it must already exist.
EOF
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --install) INSTALL=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-load) NO_LOAD=1 ;;
    --only) [ "$#" -ge 2 ] || die '--only needs a value'; ONLY="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done
case "$ONLY" in ''|,*|*,|*,,*) die 'Empty step in --only' ;; esac
IFS=',' read -r -a REQUESTED <<< "$ONLY"
for step in "${REQUESTED[@]}"; do
  case "$step" in all|prerequisites|checkout|signing|deps|build|fonts|settings|app|cli|skills|updater|launchd) ;; *) die "Unknown step: $step" ;; esac
done
selected() { [[ ",$ONLY," == *,all,* || ",$ONLY," == *,$1,* ]]; }
run() {
  printf '+'; printf ' %q' "$@"; printf '\n'
  if [ "$DRY_RUN" -eq 0 ]; then "$@"; fi
}
in_checkout() { run bash -c 'cd "$1" && shift && "$@"' bash "$CHECKOUT" "$@"; }
backup() {
  local target
  target="$1.backup-$(date +%Y%m%dT%H%M%S)-$$"
  while [ -e "$target" ] || [ -L "$target" ]; do target="$target-1"; done
  run mv "$1" "$target"
}

if [ "$DRY_RUN" -eq 0 ] && [ "$INSTALL" -eq 0 ]; then
  if selected signing || selected fonts || selected app || { selected launchd && [ "$NO_LOAD" -eq 0 ]; }; then
    die 'Jose must say "install" before using --install. Use --dry-run to preview, or --only skills,updater,launchd --no-load for file-only setup.'
  fi
fi
command -v python3 >/dev/null || die 'Python 3 missing. Fix on macOS: xcode-select --install'
NODE_MAJOR="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["engines"]["node"])' "$SOURCE_REPO/package.json")"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || die 'package.json engines.node must pin one major; review the prerequisite check.'
PNPM_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["packageManager"].split("@",1)[1].split("+",1)[0])' "$SOURCE_REPO/package.json")"
export PATH="$HOME/.local/bin:/opt/homebrew/opt/node@$NODE_MAJOR/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

check_prerequisites() {
  local missing=0 auth version
  missing() { printf 'MISSING: %s\nFix: %s\n' "$1" "$2" >&2; missing=1; }
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "CHECK Apple Silicon macOS, Xcode command line tools, Homebrew, Python 3" \
      "CHECK Node $NODE_MAJOR (package.json engines.node), Corepack and pnpm $PNPM_VERSION" \
      'CHECK Git >= 2.45, gh authenticated as Grinsven with repo and workflow scopes' \
      'CHECK Claude CLI authentication, Git commit name and email, signing tools'
    return
  fi
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || die 'Run on an Apple Silicon Mac in a native arm64 terminal.'
  xcode-select -p >/dev/null 2>&1 || missing 'Xcode command line tools' 'xcode-select --install'
  command -v brew >/dev/null || missing Homebrew "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
    missing "Node $NODE_MAJOR" "brew install node@$NODE_MAJOR; export PATH=\"/opt/homebrew/opt/node@$NODE_MAJOR/bin:\$PATH\""
  fi
  if ! command -v corepack >/dev/null; then
    missing Corepack 'brew install corepack; corepack enable pnpm'
  elif ! command -v pnpm >/dev/null; then
    missing pnpm "corepack enable pnpm; corepack prepare pnpm@$PNPM_VERSION --activate"
  elif [ "$(cd "$SOURCE_REPO" && corepack pnpm --version)" != "$PNPM_VERSION" ] || [ "$(cd "$SOURCE_REPO" && pnpm --version)" != "$PNPM_VERSION" ]; then
    missing "pnpm $PNPM_VERSION via Corepack" "corepack enable pnpm; corepack prepare pnpm@$PNPM_VERSION --activate"
  fi
  version="$(git --version 2>/dev/null | awk '{print $3}' || true)"
  if ! python3 -c 'import sys; v=sys.argv[1].split("."); sys.exit(tuple(map(int,v[:2])) < (2,45))' "$version" 2>/dev/null; then
    missing 'Git >= 2.45 (updater uses cherry-pick --empty=drop)' 'brew install git'
  fi
  if ! command -v gh >/dev/null; then
    missing 'GitHub CLI' 'brew install gh; gh auth login --hostname github.com --web --scopes repo,workflow'
  else
    auth="$(gh auth status --hostname github.com --active 2>&1 || true)"
    if [ "$(gh api user --jq .login 2>/dev/null || true)" != Grinsven ]; then
      missing 'Active Grinsven GitHub login' 'gh auth login --hostname github.com --web --scopes repo,workflow; gh auth switch --hostname github.com --user Grinsven'
    fi
    if ! printf '%s\n' "$auth" | grep -Eq "Token scopes:.*['\"]repo['\"]" || ! printf '%s\n' "$auth" | grep -Eq "Token scopes:.*['\"]workflow['\"]"; then
      missing 'repo and workflow GitHub token scopes' 'gh auth switch --hostname github.com --user Grinsven; gh auth refresh --hostname github.com --scopes repo,workflow'
    fi
  fi
  if ! command -v claude >/dev/null; then
    missing 'Claude CLI (for updater repairs)' 'brew install --cask claude-code; claude auth login'
  elif ! claude auth status >/dev/null 2>&1; then
    missing 'Claude CLI login' 'claude auth login'
  fi
  git -C "$SOURCE_REPO" var GIT_AUTHOR_IDENT >/dev/null 2>&1 || missing 'Git commit identity' 'git config --global user.name "Grinsven"; git config --global user.email "YOUR_GITHUB_COMMIT_EMAIL"'
  for tool in openssl security codesign; do
    command -v "$tool" >/dev/null || missing "$tool" 'xcode-select --install'
  done
  [ -x /usr/libexec/PlistBuddy ] || missing PlistBuddy 'softwareupdate --install --all'
  [ "$missing" -eq 0 ] || die 'Fix the prerequisites above, then rerun.'
}

prepare_checkout() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'CHECK %s is a clean, full clone of this fork; refuse unrelated repos and worktrees\n' "$CHECKOUT"
    run git clone --origin private "$PRIVATE" "$CHECKOUT"
    run git -C "$CHECKOUT" remote add origin "$UPSTREAM"
    run git -C "$CHECKOUT" fetch private
    run git -C "$CHECKOUT" fetch origin --tags
    printf 'IF shallow: fetch --unshallow from its existing source before changing remotes\n'
    printf 'CHECKOUT %s from private/main if missing; never reset existing work\n' "$BRANCH"
    printf 'WRITE %s/.orca-fork-base from the nearest first-parent upstream release tag; back up a differing file\n' "$CHECKOUT"
    return
  fi
  if [ ! -e "$CHECKOUT" ]; then
    run mkdir -p "$(dirname "$CHECKOUT")"
    run git clone --origin private "$PRIVATE" "$CHECKOUT"
  fi
  [ -d "$CHECKOUT/.git" ] && [ ! -L "$CHECKOUT" ] || die "$CHECKOUT must be a standalone clone, not a worktree or symlink."
  [ -z "$(git -C "$CHECKOUT" status --porcelain)" ] || die "$CHECKOUT has local changes. Run git -C '$CHECKOUT' status --short."
  local remote url clone_source='' base upstream_tag marker
  for remote in origin private; do
    url="$(git -C "$CHECKOUT" remote get-url "$remote" 2>/dev/null || true)"
    case "$url" in
      "$UPSTREAM"|"$UPSTREAM.git"|git@github.com:stablyai/orca.git) clone_source="${clone_source:-$remote}" ;;
      "$PRIVATE"|https://github.com/Grinsven/orca-patched|git@github.com:Grinsven/orca-patched.git) clone_source="$remote" ;;
      '') ;;
      *) die "Unexpected $remote remote in $CHECKOUT. Inspect it before setup." ;;
    esac
  done
  [ -n "$clone_source" ] || die 'No recognized upstream or private clone remote.'
  if [ "$(git -C "$CHECKOUT" rev-parse --is-shallow-repository)" = true ]; then
    run git -C "$CHECKOUT" fetch --unshallow "$clone_source"
  fi
  for remote in origin private; do
    url="$UPSTREAM"; [ "$remote" != private ] || url="$PRIVATE"
    if git -C "$CHECKOUT" remote get-url "$remote" >/dev/null 2>&1; then
      run git -C "$CHECKOUT" remote set-url "$remote" "$url"
    else
      run git -C "$CHECKOUT" remote add "$remote" "$url"
    fi
  done
  run git -C "$CHECKOUT" fetch private
  run git -C "$CHECKOUT" fetch origin --tags
  if git -C "$CHECKOUT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    run git -C "$CHECKOUT" checkout "$BRANCH"
  else
    run git -C "$CHECKOUT" checkout -b "$BRANCH" private/main
  fi
  run git -C "$CHECKOUT" branch --set-upstream-to=private/main "$BRANCH"
  base="$(git -C "$CHECKOUT" describe --tags --first-parent --abbrev=0 --match 'v[0-9]*' "$BRANCH")" || die 'Cannot determine the upstream base tag.'
  upstream_tag="$(git -C "$CHECKOUT" ls-remote origin "refs/tags/$base")"
  [ "${upstream_tag%%[[:space:]]*}" = "$(git -C "$CHECKOUT" rev-parse "refs/tags/$base")" ] || die "$base is not the matching upstream tag."
  marker="$CHECKOUT/.orca-fork-base"
  if [ -L "$marker" ] || { [ -e "$marker" ] && ! cmp -s "$marker" <(printf '%s\n' "$base"); }; then backup "$marker"; fi
  if [ ! -f "$marker" ]; then printf '%s\n' "$base" > "$marker"; fi
  if ! grep -qxF '/.orca-fork-base*' "$CHECKOUT/.git/info/exclude"; then
    run cp -p "$CHECKOUT/.git/info/exclude" "$CHECKOUT/.git/info/exclude.backup-$(date +%Y%m%dT%H%M%S)-$$"
    printf '\n/.orca-fork-base*\n/.worktrees/\n' >> "$CHECKOUT/.git/info/exclude"
  fi
}

create_signing_identity() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'CHECK valid signing identity "%s"; reuse it if present\n' "$SIGN_ID"
    printf 'IF missing: generate a private RSA key and certificate in a temporary directory using files/codesign-ext.cnf\n'
    printf 'IMPORT PEM key and certificate into %s/Library/Keychains/login.keychain-db; trust for codeSign; verify identity; remove temporary key\n' "$HOME"
    return
  fi
  if security find-identity -v -p codesigning | grep -Fq "\"$SIGN_ID\""; then return; fi
  if security find-certificate -c "$SIGN_ID" >/dev/null 2>&1; then
    die 'A certificate exists but its signing identity is invalid. Repair it using files/skills/orca-patched-deploy/references/signing-identity.md; do not replace it silently.'
  fi
  (
    umask 077
    signing_tmp="$(mktemp -d)"
    trap 'rm -rf "$signing_tmp"' EXIT
    run openssl req -x509 -newkey rsa:2048 -keyout "$signing_tmp/orca-sign.key" -out "$signing_tmp/orca-sign.pem" -days 3650 -nodes -config "$SETUP_DIR/files/codesign-ext.cnf"
    run security import "$signing_tmp/orca-sign.key" -k "$HOME/Library/Keychains/login.keychain-db" -T /usr/bin/codesign
    run security import "$signing_tmp/orca-sign.pem" -k "$HOME/Library/Keychains/login.keychain-db"
    run security add-trusted-cert -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" "$signing_tmp/orca-sign.pem"
    security find-identity -v -p codesigning | grep -Fq "\"$SIGN_ID\"" || die 'Signing identity is not valid.'
  )
}

install_app() {
  if [ "$DRY_RUN" -eq 0 ]; then
    [ -d "$CHECKOUT/dist/mac-arm64/Orca.app" ] || die 'No built app. Run the build step first.'
    if pgrep -f '^/Applications/Orca Patched.app/Contents/MacOS/Orca( |$)|Orca Patched.app/.*daemon-entry' >/dev/null; then
      die 'Orca Patched or its daemon is running. Quit it and stop its sessions before retrying; setup will not terminate them.'
    fi
  fi
  if [ -e "$APP" ] || [ -L "$APP" ]; then backup "$APP"; fi
  run cp -R "$CHECKOUT/dist/mac-arm64/Orca.app" "$APP"
  run /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Orca Patched'" "$APP/Contents/Info.plist"
  run /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.stablyai.orca.patched' "$APP/Contents/Info.plist"
  run codesign --force --deep -s "$SIGN_ID" "$APP"
  run codesign --verify --deep --strict "$APP"
  run rm -rf "$CHECKOUT/dist/mac" "$CHECKOUT/dist/mac-arm64"
  run find "$CHECKOUT/dist" -maxdepth 1 -type f \( -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' \) -delete
}

install_files() {
  local args=("$SETUP_DIR/install-files.py" "$1")
  [ "$DRY_RUN" -eq 0 ] || args+=(--dry-run)
  python3 "${args[@]}"
}
load_launchd() {
  if [ "$NO_LOAD" -eq 1 ]; then printf 'SKIP launchd load (--no-load)\n'; return; fi
  local domain job
  domain="gui/$(id -u)"
  job="$domain/nl.josetorres.orca-fork-update"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'IF already loaded: bootout %s before reloading the generated plist\n' "$job"
  elif launchctl print "$job" >/dev/null 2>&1; then
    run launchctl bootout "$job"
  fi
  run launchctl bootstrap "$domain" "$PLIST"
  run launchctl enable "$job"
}

if selected prerequisites || selected checkout || selected signing || selected deps || selected build || selected app; then check_prerequisites; fi
if selected checkout; then prepare_checkout; fi
if selected signing; then create_signing_identity; fi
if selected deps; then
  in_checkout pnpm run install:release
  in_checkout bash -c 'cd mobile && pnpm install --frozen-lockfile'
fi
if selected build; then
  if [ "$SKIP_BUILD" -eq 1 ]; then printf 'SKIP build (--skip-build)\n'; else in_checkout env ORCA_BACKGROUND_LAUNCH=1 pnpm run build:mac --arm64 --dir; fi
fi
if selected fonts; then
  printf 'CHECK the snapshot font families: Geist is bundled, Menlo is part of macOS\n'
  if [ "$DRY_RUN" -eq 1 ] || python3 -c 'import json,sys; s=json.load(open(sys.argv[1]))["settings"]; sys.exit(not any("JetBrainsMono Nerd Font" in s.get(k, "") for k in ("appFontFamily", "terminalFontFamily", "editorFontFamily")))' "$SETUP_DIR/files/orca-settings.json"; then
    if [ "$DRY_RUN" -eq 1 ] || ! brew list --cask font-jetbrains-mono-nerd-font >/dev/null 2>&1; then
      run brew install --cask font-jetbrains-mono-nerd-font
    fi
  fi
fi
if selected settings; then
  printf 'CHECK Orca profile is not active; merge only portable preferences and keybindings with timestamped backups\n'
  run bash -c 'cd "$1" && shift && env TSX_DISABLE_CACHE=1 node --import tsx "$@"' bash "$SOURCE_REPO" "$SETUP_DIR/settings-transfer.ts" apply
fi
if selected app; then install_app; fi
for step in cli skills updater launchd; do
  if selected "$step"; then install_files "$step"; fi
done
if selected launchd; then load_launchd; fi
printf 'Setup complete%s.\n' "$([ "$DRY_RUN" -eq 0 ] || printf ' (dry run, no changes)')"
