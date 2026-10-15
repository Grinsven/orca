You are inside a git worktree of the Orca repo (stablyai/orca fork) where Jose's fork commits were just replayed onto a newer upstream release tag. The cherry-pick completed, but verification is red.

Reproduce, then fix:

1. `pnpm run typecheck:web` and `pnpm run typecheck:node`
2. `npx vitest run --config config/vitest.config.ts src/shared/keybindings src/shared/claude-statusline-rate-limits.test.ts src/renderer/src/components/tab-bar src/renderer/src/components/status-bar src/renderer/src/components/right-sidebar/source-control`
3. `npx oxlint` on the files changed by the fork commits (`git diff --name-only <tag>..HEAD`)

Fix the failures at their root: usually an upstream rename, a moved export, a changed store shape, or a stale `config/tsconfig.tc.web.tsbuildinfo` (delete it if tsc reports a symbol that verifiably exists). Keep the fork features working; do not delete a fork feature to make a check pass. Edit test expectations only when upstream legitimately changed the contract.

Rules: no `git push`, no remote access, no branch switching, no full `build:mac`, no max-lines disables, concise "why" comments only (see AGENTS.md).

Leave your edits uncommitted (the caller commits them). Finish with one line: `GREEN` or `BLOCKED: <reason>`.
