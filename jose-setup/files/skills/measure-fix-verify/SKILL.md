---
name: measure-fix-verify
description: Use when something in a real app "doesn't work", "is slow", "barely works" or shows a confusing message and the cause is not yet known. Runs a measured scope → diagnose → verify-causes → parallel fix → end-to-end verify workflow in an isolated git worktree, where EVERY stage sizes itself to the problem's measured complexity (no hard-coded agent counts). Use for bug hunts, performance problems and "the feature is broken" reports, especially when the user asks for parallel agents or ultracode.
---

# Measure, fix, verify

Fixing only works when it starts from facts. This procedure first builds a harness that measures the real code path on real inputs. Several diagnosers then read that output through different lenses, a skeptic tries to disprove each claimed root cause, fixers split the confirmed causes by file ownership, and the same harness proves the result. Every count (diagnosers, skeptics, fixers, verify rounds) comes from a scoping step, never from a constant.

## 0. Right-size first (read this before anything else)

Write one line before launching: _what is the smallest change that fixes this, and what one check proves it?_

- Cause known or nearly known → do NOT use this skill. One agent fixes and verifies (typecheck + the single real check). ~10 minutes.
- Cause genuinely unknown after a quick look → this skill, with 2–3 lenses. Stop diagnosing the moment lenses agree.
- Never stack verification. One verify round, no skeptic panels, no review phase unless the change is security/stealth-critical or the user asks.
- Log the expected agent count before launching. More than ~5 agents for a bug fix means the sizing is wrong.
- On 2026-09-26 this skill turned a 10-minute Dock-tile fix into a 2-hour, 2.7M-token run (7 diagnosers agreed on the cause and the pipeline still queued merge + skeptics + fixers + verify). That is the failure mode to avoid.

## 1. Isolate (always, before any agent runs)

- One git worktree and branch per problem: `git worktree add <scratchpad>/wt/<slug> -b fix/<slug> <base>`. Symlink dependencies instead of reinstalling (`ln -s <repo>/node_modules <wt>/node_modules`). Model files, `.env` and other untracked assets are NOT in a worktree, so copy what the harness needs.
- Give each parallel workflow its own debug port and a fresh temp profile/user-data dir. Two workflows sharing a port or profile corrupt each other's runs.
- Every prompt carries the safety rules: only edit inside the worktree, only kill processes whose command line contains YOUR profile path, never push, never print secrets, never start real capture/payments/sends.

## 1. Scope (1 cheap agent, read-only)

Returns the complexity signals every later stage scales from (see `workflow-template.js`, `SCOPE_SCHEMA`):

- `subsystems`: distinct areas the symptom plausibly touches, with key files.
- `symptoms`: distinct user-visible failures reported or found.
- `evidence_kind`: `measurable` (numbers decide it), `judgment` (reading code/UX decides it) or `mixed`.
- `uncertainty`: `low | medium | high` (how many competing explanations exist).
- `platforms`: which OS/runtime branches are involved.
- `lenses`: the diagnostic perspectives that are actually relevant here, chosen from: measurement, code-path, user-journey, platform/edge, data/inputs, concurrency/lifecycle, security/privacy, performance, configuration/environment, recent-changes (git log/blame). Only lenses with a concrete reason to apply.
- `harness_plan`: what to measure, on which real inputs, and how to run it opt-in (e.g. `RUN_X_E2E=1`).

## 2. Harness (1 agent)

Build ONE reusable, opt-in harness script that drives the real code path (compiled modules, real app over CDP, real CLIs) on real inputs, read-only for user data. It must output numbers and the exact user-facing messages traced to file:line. Commit only the harness. Everyone after this reuses it; diagnosers never write their own.

## Diagnose (N agents, N = relevant lenses)

- One diagnoser per lens from the scope. Nothing fixed: a problem with one subsystem and measurable evidence may get 1-2 lenses; a vague "barely works" across UI, backend and a CLI may get 6+. Cap only by the concurrency limit, and `log()` any lens that was dropped.
- Each diagnoser gets the harness output and code, and returns root causes with evidence, severity and implicated files.
- Merge by UNION, never by majority vote, and merge by MEANING: one merge agent clusters the raw findings into distinct root causes (same cause = fixing one mechanism fixes both). String/title matching under-merges badly: a real run turned ~10 root causes into 85 "unique" ones and spawned 228 agents. Record how many lenses found each cause; that count is a confidence signal, not a filter.

## Triage (one agent)

One agent merges the lenses' findings by meaning (same cause = fixing one mechanism fixes both) and drops only what it can show is not real. No skeptic votes: several independent lenses reporting the same mechanism with harness evidence is already confirmation.

## Fix (M agents, M = ownership clusters)

- Group confirmed causes by the FILES they implicate, not by bug. Each cluster becomes one fixer that exclusively owns those files. M is however many clusters there are.
- Coverage gate before launching fixers: every confirmed cause must be owned by some fixer. An unowned cause gets its own fixer or joins the closest cluster. This is the gap that lets a known bug slip through unfixed.
- Shared hot files (god objects, IPC contracts, main entry points) belong to exactly one fixer, or to a final reconcile step. Other fixers write precise requests for them instead of editing.
- Each fixer gets the full diagnosis, plus "the other fixers change adjacent interfaces concurrently; consume them defensively", and commits in small logical commits.

## Verify (one round)

One agent: reconcile drift (typecheck, build, unit tests) → rerun the SAME harness and the app-level check → fix remaining failures at the root → commit. A second round only when the user asks.

## Report

- A before/after table from the harness on the same inputs.
- Each confirmed cause: fixed, or not fixed and why.
- Refuted causes.
- Validation categories kept strictly apart: tested physically, covered by automated tests (per platform branch), reviewed but not executed, requires verification on another platform.
- Stray side effects (child processes left running, ports, files).

## Gotchas seen in practice

- Parallel workflows collided on the same debug port and on a shared helper script in the scratchpad: give each workflow its own port AND its own helper file names.
- Test apps can spawn background daemons (e.g. `ollama serve`) that survive killing the app: check for new processes after teardown.
- Worktrees lack untracked model/asset files, so the harness may "fail" for reasons unrelated to the bug.
- Opt-in flags (`RUN_X_E2E=1`) keep real-data / real-CLI tests out of CI.
- A single agent's "ALL GREEN" is a claim: the orchestrator reads the numbers before relaying them.

## Files

- `workflow-template.js`: the Workflow script. Pass `args` = `{ problem, repo, worktree, branch, base, port, scratch, rules, model? }` (`model: 'opus'` forces every agent onto Opus; omit to inherit the session model). It is complete as-is; edit only the problem-specific prompt text if needed.
- `cdp.mjs`: dependency-free CDP helper for Electron/Chrome apps (eval, click-by-text, type, screenshot, console capture) for app-level E2E.
