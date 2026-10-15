You are inside a git worktree of the Orca repo (stablyai/orca fork) where `git cherry-pick` stopped on conflicts while replaying Jose's fork commits onto a newer upstream release tag.

Your job: finish the cherry-pick so every fork commit's intent survives on top of upstream.

Rules:

1. Run `git status` and `git diff --name-only --diff-filter=U` to see the conflicted files. Read each conflict hunk and the commit being applied (`git log -1 --format=%B CHERRY_PICK_HEAD`).
2. Resolve by keeping the fork commit's intent AND upstream's newer code. Prefer upstream's structure; re-apply the fork's change on top of it. Never resolve by blindly taking one side.
3. If upstream already contains the same feature as the commit being applied (for example the `tab.moveToNewPaneColumn` keybinding landed upstream), drop the commit with `git cherry-pick --skip` instead of duplicating it.
4. After resolving: `git add -A` then `GIT_EDITOR=true git -c core.hooksPath=/dev/null cherry-pick --continue`. Repeat until `git status` shows no cherry-pick in progress.
5. Do NOT run `git push`, do NOT touch any remote, do NOT switch branches, do NOT run the full build.
6. When the cherry-pick is finished, run `pnpm run typecheck:web` and `pnpm run typecheck:node` if node_modules exist; fix any errors your resolution introduced. If node_modules do not exist yet, skip typecheck (the caller installs and verifies next).
7. Follow the repo's AGENTS.md: concise "why" comments only, never disable max-lines, no vague file names.

Finish with one line: `RESOLVED <n> conflicts, <m> commits skipped` or `BLOCKED: <reason>`.
