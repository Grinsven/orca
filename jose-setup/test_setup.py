#!/usr/bin/env python3
"""Exercise real file installs and Git sync entirely inside the worktree's .tmp."""

import hashlib
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest


SETUP = Path(__file__).resolve().parent


def snapshot(root):
    result = {}
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        content = os.readlink(path) if path.is_symlink() else hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "directory"
        result[str(path.relative_to(root))] = (content, info.st_mode, info.st_mtime_ns)
    return result


class SetupTests(unittest.TestCase):
    def setUp(self):
        scratch = SETUP.parent / ".tmp"
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="jose-setup-test-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home with & and ' quote"
        self.home.mkdir()
        blockers = self.home / ".local/bin"
        blockers.mkdir(parents=True)
        for name in ("launchctl", "security", "codesign", "pnpm", "corepack", "gh", "claude", "brew", "open", "osascript"):
            blocker = blockers / name
            blocker.write_text('#!/bin/bash\nprintf "Forbidden test command: %s\\n" "$0" >&2\nexit 97\n')
            blocker.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), TMPDIR=str(self.root),
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull,
                        GIT_TERMINAL_PROMPT="0", ORCA_BACKGROUND_LAUNCH="1")
        for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
            self.env.pop(name, None)

    def command(self, *args, cwd=None, success=True):
        result = subprocess.run(args, cwd=cwd or self.root, env=self.env,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result.stdout

    def install(self, *args):
        return self.command("bash", str(SETUP / "setup.sh"), *args)

    def test_real_file_install_rerun_backup_and_dry_run(self):
        before = snapshot(self.home)
        output = self.install("--dry-run")
        self.assertEqual(snapshot(self.home), before)
        self.assertIn("build:mac --arm64 --dir", output)
        self.assertIn("bootstrap", output)
        self.assertIn("dry run, no changes", output)
        print("PASS full setup --dry-run: no HOME changes")

        args = ("--only", "skills,updater,launchd,cli", "--no-load")
        output = self.install(*args)
        self.assertIn("SKIP launchd load", output)
        for source in (SETUP / "files/skills").rglob("*"):
            if source.is_file():
                destination = self.home / ".claude/skills" / source.relative_to(SETUP / "files/skills")
                self.assertEqual(destination.read_bytes(), source.read_bytes())
        self.assertEqual((self.home / ".local/bin/orca-fork-update").read_bytes(), (SETUP / "files/orca-fork-update").read_bytes())
        for source in (SETUP / "files/prompts").glob("*.md"):
            self.assertEqual((self.home / ".local/share/orca-fork-update" / source.name).read_bytes(), source.read_bytes())
        plist = plistlib.loads((self.home / "Library/LaunchAgents/nl.josetorres.orca-fork-update.plist").read_bytes())
        self.assertEqual(plist["ProgramArguments"], [str(self.home / ".local/bin/orca-fork-update"), "auto"])
        self.assertEqual(plist["EnvironmentVariables"]["HOME"], str(self.home))
        self.assertEqual(plist["StartCalendarInterval"], {"Hour": 7, "Minute": 0})
        self.assertFalse(plist["RunAtLoad"])
        self.assertTrue(os.access(self.home / ".local/bin/orca", os.X_OK))
        print("PASS real file install: 4 skills, updater, 2 prompts, 07:00 plist, CLI and PATH profiles")

        before = snapshot(self.home)
        self.install(*args)
        self.assertEqual(snapshot(self.home), before)
        self.install(*args, "--dry-run")
        self.assertEqual(snapshot(self.home), before)
        print("PASS rerun: file bytes, modes and mtimes unchanged")

        skill = self.home / ".claude/skills/orca-cli/SKILL.md"
        skill.write_text("local custom skill\n")
        self.install(*args)
        backups = list(skill.parent.glob("SKILL.md.backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), "local custom skill\n")
        self.assertEqual(skill.read_bytes(), (SETUP / "files/skills/orca-cli/SKILL.md").read_bytes())
        before = snapshot(self.home)
        self.install(*args)
        self.assertEqual(snapshot(self.home), before)
        print("PASS differing file: timestamped backup preserves original; next rerun unchanged")

    def test_destination_symlink_is_backed_up_not_followed(self):
        outside = self.root / "outside-home"
        outside.mkdir()
        (outside / "keep.txt").write_text("preserve me")
        (self.home / ".claude").mkdir()
        (self.home / ".claude/skills").symlink_to(outside, target_is_directory=True)
        before = snapshot(outside)
        self.install("--only", "skills")
        self.assertEqual(snapshot(outside), before)
        self.assertFalse((self.home / ".claude/skills").is_symlink())
        self.assertTrue(next((self.home / ".claude").glob("skills.backup-*")).is_symlink())
        print("PASS destination symlink: backed up; external target untouched")

    def test_terminal_font_installs_only_when_missing(self):
        brew = self.home / ".local/bin/brew"
        brew.write_text('#!/bin/bash\nset -eu\ncase "$1" in\nlist) test -f "$HOME/font-installed" ;;\ninstall) test "$2" = --cask; test "$3" = font-jetbrains-mono-nerd-font; printf installed > "$HOME/font-installed" ;;\n*) exit 97 ;;\nesac\n')
        brew.chmod(0o755)
        self.install("--only", "fonts", "--install")
        self.assertEqual((self.home / "font-installed").read_text(), "installed")
        before = snapshot(self.home)
        self.install("--only", "fonts", "--install")
        self.assertEqual(snapshot(self.home), before)
        print("PASS font step with Homebrew stub: correct cask installed only when missing")

    def git(self, cwd, *args):
        return self.command("git", "-C", str(cwd), *args).strip()

    def commit(self, repo, name, content):
        (repo / name).write_text(content)
        self.git(repo, "add", "--", name)
        self.git(repo, "-c", "user.name=Setup Test", "-c", "user.email=setup@example.invalid", "commit", "-m", content)
        return self.git(repo, "rev-parse", "HEAD")

    def fixture(self):
        seed = self.root / "seed"
        seed.mkdir()
        self.git(seed, "init", "-b", "main")
        self.commit(seed, "base.txt", "upstream one")
        self.git(seed, "tag", "v1.0.0")
        self.git(seed, "branch", "upstream")
        old = self.commit(seed, "fork.txt", "fork before replay")
        remote = self.root / "mirror.git"
        self.command("git", "clone", "--bare", str(seed), str(remote))
        clone = self.root / "clone"
        self.command("git", "clone", "--origin", "private", str(remote), str(clone))
        self.git(seed, "checkout", "-B", "main", "upstream")
        self.commit(seed, "base.txt", "upstream two")
        self.git(seed, "tag", "v1.0.1")
        target = self.commit(seed, "fork.txt", "fork after replay")
        # Updating this local fixture through fetch never pushes to any remote.
        self.git(remote, "fetch", "--force", "--tags", str(seed), "main:main")
        return clone, old, target

    def sync(self, clone, *args, success=True):
        return self.command("bash", str(SETUP / "sync.sh"), *args, cwd=clone, success=success)

    def test_clean_rewritten_remote_and_sync_rerun(self):
        clone, old, target = self.fixture()
        before = snapshot(clone)
        output = self.sync(clone, "--dry-run")
        self.assertIn("Final comparison requires a fetch", output)
        self.assertEqual(snapshot(clone), before)
        self.sync(clone)
        self.assertEqual(self.git(clone, "rev-parse", "HEAD"), target)
        self.assertEqual(self.git(clone, "rev-parse", "refs/jose-setup/sync-base/main"), target)
        backups = self.git(clone, "for-each-ref", "--format=%(objectname)", "refs/jose-setup/sync-backups/main")
        self.assertEqual(backups, old)
        self.sync(clone)
        self.assertEqual(self.git(clone, "for-each-ref", "--format=%(objectname)", "refs/jose-setup/sync-backups/main"), old)
        before = snapshot(clone)
        self.sync(clone, "--dry-run")
        self.assertEqual(snapshot(clone), before)
        print("PASS sync: rewritten bare remote accepted, old HEAD backed up, rerun stable, dry-run changes no files/refs")

    def test_local_commit_refused_twice_and_preserved(self):
        clone, old, _ = self.fixture()
        local = self.commit(clone, "local.txt", "local-only change")
        for _ in range(2):
            output = self.sync(clone, success=False)
            self.assertIn(local + " local-only change", output)
            self.assertNotIn(old + " fork before replay", output)
            self.assertEqual(self.git(clone, "rev-parse", "HEAD"), local)
            self.assertEqual((clone / "local.txt").read_text(), "local-only change")
            self.assertEqual(self.git(clone, "rev-parse", "refs/jose-setup/sync-base/main"), old)
        print("PASS sync refusal twice: exact local commit reported and retained after forced remote rewrite")

    def test_dirty_staged_untracked_preserved(self):
        clone, old, _ = self.fixture()
        (clone / "base.txt").write_text("unstaged work")
        (clone / "fork.txt").write_text("staged work")
        self.git(clone, "add", "fork.txt")
        (clone / "untracked.txt").write_text("untracked work")
        output = self.sync(clone, success=False)
        for name in ("base.txt", "fork.txt", "untracked.txt"):
            self.assertIn(name, output)
        self.assertEqual(self.git(clone, "rev-parse", "HEAD"), old)
        self.assertEqual((clone / "base.txt").read_text(), "unstaged work")
        self.assertEqual((clone / "fork.txt").read_text(), "staged work")
        self.assertEqual((clone / "untracked.txt").read_text(), "untracked work")
        self.assertEqual(self.git(clone, "diff", "--cached", "--name-only"), "fork.txt")
        print("PASS sync refusal: staged, unstaged and untracked paths reported and preserved")

    def test_sync_updates_upstream_marker_with_backup(self):
        clone, _, _ = self.fixture()
        (clone / ".git/info/exclude").write_text("/.orca-fork-base*\n")
        marker = clone / ".orca-fork-base"
        marker.write_text("v1.0.0\n")
        self.sync(clone)
        self.assertEqual(marker.read_text(), "v1.0.1\n")
        self.assertEqual(next(clone.glob(".orca-fork-base.backup-*")).read_text(), "v1.0.0\n")
        self.sync(clone)
        self.assertEqual(len(list(clone.glob(".orca-fork-base.backup-*"))), 1)
        print("PASS sync: upstream marker advances with a backup for the next scheduled replay")

    def test_ignored_directory_replaced_by_tracked_file_is_preserved(self):
        clone, old, _ = self.fixture()
        seed = self.root / "seed"
        self.commit(seed, "cache", "tracked replacement")
        self.git(self.root / "mirror.git", "fetch", "--force", str(seed), "main:main")
        (clone / ".git/info/exclude").write_text("/cache/\n")
        (clone / "cache").mkdir()
        (clone / "cache/local.txt").write_text("ignored local data")
        output = self.sync(clone, success=False)
        self.assertIn("target path: cache", output)
        self.assertEqual((clone / "cache/local.txt").read_text(), "ignored local data")
        self.assertEqual(self.git(clone, "rev-parse", "HEAD"), old)
        print("PASS sync refusal: ignored directory-to-file collision preserves local data")

    def test_missing_baseline_refuses_divergent_history(self):
        clone, old, _ = self.fixture()
        self.git(clone, "update-ref", "-d", "refs/remotes/private/main")
        for _ in range(2):
            output = self.sync(clone, success=False)
            self.assertIn(old, output)
            self.assertEqual(self.git(clone, "rev-parse", "HEAD"), old)
        print("PASS sync refusal: missing provenance never discards divergent commits")


if __name__ == "__main__":
    unittest.main(verbosity=2)
