---
name: orca-patched-deploy
description: "Build, install, or troubleshoot Jose's Orca Patched app and its stable macOS signing identity."
---

# Orca Patched: build, swap, sign

Deploys a new build of Jose's Orca fork to `/Applications/Orca Patched.app` with a stable code signature so macOS TCC consent ("access data from other apps") persists instead of re-prompting.

The stock `/Applications/Orca.app` must stay untouched (fallback + auto-update path).

## Signing identity

Check `security find-identity -v -p codesigning`. If the stable identity is absent or needs repair, read [signing-identity.md](references/signing-identity.md). Reuse a valid existing identity for routine builds.

For an upstream update, use the existing `orca-fork-update` command described below. Use the manual procedure for installing a build from the current checkout; an ordinary rebuild does not authorize updating upstream or resetting a branch.

## Authorization

For this fork, read `jose-setup/AGENT-SETUP.md` first. Never install without Jose saying "install" in the current conversation. Never push manually without his explicit yes. Scheduled behavior below describes the installed updater, not permission for an agent to run it.

## Deploy procedure

1. Install first: `pnpm run install:release` in the repo root (adds the x64 native variants `build:mac` packages next to arm64; a plain install prunes them) AND `pnpm install --frozen-lockfile` in `mobile/` (its own pnpm project; since v1.4.210 `build:desktop` bundles the mobile web app and fails on unresolved `expo-router`/`react-native` without it). Then build Apple Silicon only: `pnpm run build:mac --arm64 --dir` (outputs `dist/mac-arm64/Orca.app`, no x64 slice, no dmg/zip). Jose wants no Intel build (8 Oct 2026); the args pass through via the fork's `config/scripts/build-mac-local.mjs`, so a plain `pnpm run build:mac` still builds both. Never edit sources while it runs , that corrupts the bundle step.
2. Quit the app: `osascript -e 'tell application "Orca Patched" to quit'`. The Orca daemon and crashpad keep running. For a routine same-signature rebuild that is fine. But whenever the signature situation changed (new identity, changed bundle ID, first signed build), also kill the daemon (`pgrep -f daemon-entry`, then `kill <pid>`) , it survives app restarts for days, keeps the OLD signature, and is the responsible process for terminal panes, so TCC keeps judging panes by the stale identity until it respawns from the new bundle. It restarts automatically when the app relaunches; open Orca terminal sessions die with it, warn Jose first.
3. Swap:
   ```bash
   rm -rf "/Applications/Orca Patched.app"
   cp -R dist/mac-arm64/Orca.app "/Applications/Orca Patched.app"
   /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Orca Patched'" \
     "/Applications/Orca Patched.app/Contents/Info.plist"
   /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.stablyai.orca.patched" \
     "/Applications/Orca Patched.app/Contents/Info.plist"
   ```
   `Set`, not `Add` , the built plist already has both keys. NEVER change `CFBundleName`: Electron resolves "<CFBundleName> Helper.app" and the app dies with "Unable to find helper app". The `CFBundleIdentifier` change to `com.stablyai.orca.patched` is MANDATORY: sharing stock Orca's `com.stablyai.orca` makes TCC match consent records against stock Orca's Developer ID signature, which the patched build can never satisfy , the "access data from other apps" prompt then returns on every Claude pane forever (diagnosed 26 Aug 2026 via tccd logs). With the unique ID + stable identity the prompt appears once per target and persists.
4. Sign with the stable identity (never `-s -`):
   ```bash
   codesign --force --deep -s "Orca Patched Signing" "/Applications/Orca Patched.app"
   ```
5. Orca config edits (theme, fonts, keybindings in `~/Library/Application Support/orca/profiles/local-default/orca-data.json`) go in NOW, while the app is quit , the loader silently reverts external edits made while it runs. Back the file up first.
6. Clean dist so Spotlight doesn't grow duplicate Orca icons: `rm -rf dist/mac dist/mac-arm64 dist/*.dmg dist/*.zip dist/*.blockmap`.
7. `open "/Applications/Orca Patched.app"` and confirm the main process is running: `pgrep -fl "Orca Patched.app/Contents/MacOS/Orca"`.

## Troubleshooting

- App won't start after swap → almost always a changed `CFBundleName` (step 3) or a half-finished build being copied.
- TCC prompt is back → identity changed (deleted/recreated) or the app was ad-hoc signed; re-run step 4 with the named identity, one final prompt round follows.
- `security import` "MAC verification failed" → you used a .p12; import the PEM key and cert separately as above.

## Automated upstream updates (added 28 Aug 2026)

`~/.local/bin/orca-fork-update` keeps `jose/oled-ui` on the newest upstream release and redeploys:

- `orca-fork-update auto` , newest `v1.4.*` tag → isolated worktree at `~/Projects/orca/.worktrees/update` → `cherry-pick -x --empty=drop <base>..jose/oled-ui` (base tag lives in `~/Projects/orca/.orca-fork-base`) → on conflicts or red checks, headless `claude -p --model opus` runs with the prompts in `~/.local/share/orca-fork-update/` (max 3 rounds each) → typecheck + targeted vitest (keybindings, statusline, tab bar, status bar, source control, sidebar two-level grouping, Modern UI settings/appearance/assets) + oxlint must be green; a fork behaviour is only protected across rebuilds when a unit test in that list covers it → only then `git reset --hard` the real branch (backup ref `backup/oled-ui-<date>` first) → `pnpm run install:release` in the checkout root + frozen install in `mobile/` → `build:mac --arm64 --dir` (Apple Silicon only) → package + sign into `~/Applications/OrcaPatchedStaging` → always installs: quits Orca Patched if running, swaps, kills the old Orca daemon (it outlives the app and would keep running the previous bundle's main-process code), relaunches, posts a macOS notification. tmux-wrapped sessions survive; native agent PTYs restart. Enabling the daily updater schedules these automatic installs.
- **07:00 only** (Jose, 8 Oct 2026): an `auto` run outside the 07:00 hour logs a skip and exits; a release that lands later waits for the next morning. `orca-fork-update now` runs the same update right away. The tag fetch retries for 5 minutes (half-awake Mac at 07:00), and any unexpected exit logs `FAIL: unexpected exit <rc> (line N)` plus a notification instead of dying silently. The swap log line names the installed bundle version (`1.4.x-local.<ts>.<fork commit>`), not just the tag.
- `orca-fork-update swap` , install a staged build by hand (only needed if a run died between packaging and install).
- `orca-fork-update status` , base vs newest tag, staged build present.
- Scheduled daily 07:00 by `~/Library/LaunchAgents/nl.josetorres.orca-fork-update.plist`; log at `~/Library/Logs/orca-fork-update.log`.
- After each successful rebuild it mirrors `jose/oled-ui` (force-with-lease, the branch is rebuilt per release), every `backup/oled-ui-*` branch, `stash/*` and the base tag to Jose's private repo https://github.com/Grinsven/orca-patched (remote `private`, Grinsven `gh` login with `repo` + `workflow` scopes; `orca-fork-update push` does it by hand). The checkout is a full clone since 10 Oct 2026: never fetch with `--depth`, a shallow boundary makes GitHub reject the push ("did not receive expected object"). Stock /Applications/Orca.app untouched. If a run dies mid-way the worktree is kept for inspection; `git worktree remove --force ~/Projects/orca/.worktrees/update` resets it.
- The updater replays the fork commits from the recorded base tag without merging upstream. Keep the checkout full; never add a shallow boundary.
