#!/bin/bash
set -euo pipefail
setup_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
for argument in "$@"; do
  if [ "$argument" = --dry-run ]; then
    printf 'Would export allowlisted Orca appearance, UI preferences, and keybindings.\n'
    printf 'Would read copied profile storage and write %s/files/orca-settings.json.\n' "$setup_dir"
    printf 'Dry run: no profile, files, caches, or app processes changed.\n'
    exit 0
  fi
done
export TSX_DISABLE_CACHE=1
export TMPDIR="$setup_dir/../.tmp"
mkdir -p "$TMPDIR"
cd "$setup_dir/.."
exec node --import tsx "$setup_dir/settings-transfer.ts" export "$@"
