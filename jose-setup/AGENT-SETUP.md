# Set up Orca Patched

This folder sets up an Apple Silicon Mac from the private fork. It installs
`/Applications/Orca Patched.app`, its `orca` command, the daily updater and four
Claude skills: `orca-cli`, `orca-patched-deploy`, `build-and-prove` and
`measure-fix-verify`. It creates the stable **Orca Patched Signing** identity only
when missing. It also restores Jose's saved colors, theme, `jose-ui` variant,
Modern UI and connected tabs, fonts, zoom, terminal, keybinding, sidebar and tab
preferences. Stock Orca stays available.
Geist ships with Orca and Menlo with macOS. Setup installs
[JetBrainsMono Nerd Font](https://formulae.brew.sh/cask/font-jetbrains-mono-nerd-font)
through Homebrew when the snapshot uses it.

You need native Apple Silicon macOS, Xcode command line tools, Homebrew, Python 3,
the Node major and Corepack pnpm version in `package.json`, Git 2.45 or newer,
and `gh` logged in as **Grinsven** with `repo` and `workflow` scopes. The updater
also needs an authenticated Claude CLI and a Git commit name and email. Setup
checks these and prints fix commands. Signing may ask for a keychain password.

Clone without `--depth`, then read this guide:

```bash
git clone https://github.com/Grinsven/orca-patched.git ~/Projects/orca
cd ~/Projects/orca
```

After Jose says **"install"**, run this one command:

```bash
bash jose-setup/setup.sh --install
```

This checks or creates the full clone at `~/Projects/orca`, sets `origin` to
`https://github.com/stablyai/orca` and `private` to the private fork, checks out
`jose/oled-ui`, and records its upstream tag in `.orca-fork-base`. It installs
release and mobile dependencies, builds arm64, copies the app, sets its display
name and unique bundle ID, signs it and removes the build artifacts. It preserves
`CFBundleName`. Quit the existing patched app and its terminal sessions first;
setup refuses to replace a running app or daemon.

The updater is copied from this Mac, with portable home paths. Loading
`nl.josetorres.orca-fork-update` schedules it at **07:00 local time** daily. It
replays `jose/oled-ui` onto the newest upstream `v1.4.*` release, can use Claude
Opus to repair conflicts, runs checks, mirrors the rewritten branch to
`Grinsven/orca-patched` including `main`, and builds and installs the new app.
This can quit Orca Patched and restart native terminal sessions. Setup does not
run the updater immediately. GitHub credentials come from `gh` at runtime.

Preview with `bash jose-setup/setup.sh --dry-run`. Choose steps with
`--only skills,updater,launchd --no-load` to install just files and generate the
plist without loading it. `--skip-build` requires an existing built app.
Use `--only prerequisites` for prerequisite checks. Every differing destination
file is saved beside it as `.backup-<timestamp>` before replacement. Identical
files are left alone. The CLI goes in `~/.local/bin`, added to `.zprofile` and
`.bash_profile`; open a new terminal to pick up PATH.

On another clone, use **`bash jose-setup/sync.sh` instead of `git pull`** because
the mirror is force-rewritten each morning. Run it from that clone, on `main` or
`jose/oled-ui`. It fetches `private`, compares against previously observed mirror
history, and resets to `private/main` only with a clean tree and no local-only
commits. Otherwise it lists local files and commit hashes and stops. A saved
Git ref preserves the previous HEAD. `--dry-run` previews without changing refs;
if the new commit is not present locally, it reports that comparison needs a fetch.

## Verify

```bash
codesign --verify --deep --strict "/Applications/Orca Patched.app"
security find-identity -v -p codesigning
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "/Applications/Orca Patched.app/Contents/Info.plist"
command -v orca
ls ~/.claude/skills/{orca-cli,orca-patched-deploy,build-and-prove,measure-fix-verify}/SKILL.md
launchctl print "gui/$(id -u)/nl.josetorres.orca-fork-update"
git -C ~/Projects/orca rev-parse --is-shallow-repository
cat ~/Projects/orca/.orca-fork-base
```

Expect the named identity, bundle ID `com.stablyai.orca.patched`, the CLI under
`~/.local/bin`, four skills, the loaded job, `false` for shallow, and an upstream
tag. Open the app yourself to check it. Logs live in `~/Library/Logs/orca-fork-update*`.

## Undo

Unload the schedule first:

```bash
launchctl bootout "gui/$(id -u)/nl.josetorres.orca-fork-update"
```

Remove the plist from `~/Library/LaunchAgents`, `~/.local/bin/orca-fork-update`,
`~/.local/share/orca-fork-update`, the four installed skill folders, and the
`~/.local/bin/orca` wrapper. Restore any `.backup-*` files instead when replacing
an earlier setup. Remove the added PATH line from the shell profiles, or restore
their backups. Quit Orca Patched before removing its app bundle; restore the
app backup if needed. With Orca quit, restore the timestamped profile and
keybinding backups to undo the imported preferences. Keep `~/Projects/orca` and the signing identity unless you
also want to remove them. Removing the identity in Keychain Access means the
next install needs fresh privacy consent.
If setup installed the font and nothing else uses it, remove it with
`brew uninstall --cask font-jetbrains-mono-nerd-font`.

## Refresh the settings snapshot

Run `bash jose-setup/export-settings.sh` on the Mac whose preferences you want to
keep. It reads the profile without changing it and updates
`jose-setup/files/orca-settings.json`. Review the diff and scan for secrets before
committing. The snapshot contains only portable preferences, never repositories,
workspaces, sessions, accounts, credentials or device IDs. Profile settings and
UI settings follow the second-window seed split, with a stricter allowlist for
export. Keybindings come from `~/.orca/keybindings.json`. The `jose-ui` variant
is read from local storage, with `vscode` as the default; if offline storage
cannot be read safely, use `--variant vscode`, `--variant gray` or `--variant oled`
after checking the current choice.

Apply a refreshed snapshot with `bash jose-setup/setup.sh --only settings` after
quitting Orca. This merges into the profile's authoritative settings storage,
including SQLite profiles, and into the keybindings file. Existing non-setting
data remains in place. A rerun with the same preferences writes nothing.

## Fork rules for agents

- Put fork logic in fork-owned files, with small hooks in upstream files.
- Never delete upstream code. Preserve both upstream behavior and fork intent.
- Start commit subjects with `jose: ` and keep commit hooks enabled.
- Rebase or replay fork commits; never merge upstream into the fork.
- `jose/oled-ui` is replayed onto each new upstream release every morning at 07:00.
- Never install without Jose saying **"install"**. Old notes are not permission.
- Never push manually without Jose's explicit yes in the current conversation.
- These fork rules take precedence over generic integration advice in the skills.

The bundled deployment skill and updater describe the scheduled workflow. They
do not authorize an agent to run it during ordinary code work.
