#!/usr/bin/env python3
"""Install the fork's files without following destination symlinks."""

import argparse
import datetime
import os
from pathlib import Path
import plistlib
import stat
import tempfile


class Installer:
    def __init__(self, home, dry_run=False):
        self.home = Path(home).absolute()
        self.dry_run = dry_run

    def backup(self, path):
        suffix = datetime.datetime.now().strftime("%Y%m%dT%H%M%S.%f")
        target = path.with_name(path.name + ".backup-" + suffix)
        print(f"BACKUP {path} -> {target}")
        if not self.dry_run:
            path.rename(target)

    def directory(self, path):
        if path == self.home:
            if not path.is_dir():
                raise SystemExit(f"HOME must already be a directory: {path}")
            return
        path.relative_to(self.home)
        self.directory(path.parent)
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            self.backup(path)
        elif path.is_dir():
            return
        print(f"MKDIR {path}")
        if not self.dry_run:
            path.mkdir()

    def file(self, path, content, mode=0o644):
        path.relative_to(self.home)
        self.directory(path.parent)
        if path.is_file() and not path.is_symlink():
            if path.read_bytes() == content and stat.S_IMODE(path.stat().st_mode) == mode:
                print(f"KEEP {path}")
                return
        if path.exists() or path.is_symlink():
            self.backup(path)
        print(f"WRITE {path}")
        if not self.dry_run:
            fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".orca-setup-")
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(content)
                os.chmod(temporary, mode)
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=["skills", "updater", "launchd", "cli"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    installer = Installer(os.environ["HOME"], args.dry_run)
    home = installer.home
    files = Path(__file__).resolve().parent / "files"
    if args.step == "skills":
        for source in sorted((files / "skills").rglob("*")):
            if source.is_file():
                installer.file(home / ".claude/skills" / source.relative_to(files / "skills"),
                               source.read_bytes(), stat.S_IMODE(source.stat().st_mode))
    elif args.step == "updater":
        installer.file(home / ".local/bin/orca-fork-update", (files / "orca-fork-update").read_bytes(), 0o755)
        for source in sorted((files / "prompts").glob("*.md")):
            installer.file(home / ".local/share/orca-fork-update" / source.name, source.read_bytes())
    elif args.step == "launchd":
        template = plistlib.loads((files / "nl.josetorres.orca-fork-update.plist.in").read_bytes())

        def expand(value):
            if isinstance(value, str):
                return value.replace("@HOME@", str(home))
            if isinstance(value, list):
                return [expand(item) for item in value]
            if isinstance(value, dict):
                return {key: expand(item) for key, item in value.items()}
            return value

        installer.directory(home / "Library/Logs")
        installer.file(home / "Library/LaunchAgents/nl.josetorres.orca-fork-update.plist",
                       plistlib.dumps(expand(template), sort_keys=False))
    elif args.step == "cli":
        installer.file(home / ".local/bin/orca", b'#!/bin/bash\nexec "/Applications/Orca Patched.app/Contents/Resources/bin/orca" "$@"\n', 0o755)
        line = b'export PATH="$HOME/.local/bin:$PATH"'
        for name in (".zprofile", ".bash_profile"):
            path = home / name
            if path.is_symlink() or (path.exists() and not path.is_file()):
                raise SystemExit(f"Refusing to edit non-regular shell profile: {path}")
            previous = path.read_bytes() if path.exists() else b""
            if line not in previous.splitlines():
                previous += (b"\n" if previous else b"") + b"# Orca Patched CLI\n" + line + b"\n"
            mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
            installer.file(path, previous, mode)


if __name__ == "__main__":
    main()
