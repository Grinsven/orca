---
name: build-and-prove
description: Use when building or changing user-facing behaviour in a real app (a desktop/Electron app, an assistant, anything with a UI, audio or model answers) and the work is big enough to split, or the user asks for parallel agents, a workflow or ultracode. A menu of proven defaults for planning, parallel implementation, integration and proving it works for real; pick only the parts that fit the task. For a bug whose cause is unknown, prefer measure-fix-verify.
---

# Build and prove

These are defaults that worked on real projects, not a checklist. Before using any of it, write one line: _what is the smallest piece of work that delivers this, and what one real check proves it?_ If that is one file and one check, skip everything below and just do it.

## Size it first

- One agent when the cause or change is clear and touches one area. A workflow only when there are independent lanes that can run at the same time.
- Agent count follows the number of independent lanes, never a fixed number. A 10-minute fix that becomes a 2-hour pipeline is the failure to avoid.
- Use the strongest model the user approved for every agent; never silently downgrade.

## Parallel build (when it fits)

- **Shared contract first** if several lanes touch the same types, settings or IPC: one short step that commits only the shared types, setting keys and channel names, so implementers do not collide.
- **One worktree and branch per lane**, each with an owned-files list. Shared hotspot files are edited by adding clearly separated blocks only.
- Tell each lane what the other lanes own, so they coordinate by staying out instead of by talking.

## Integrate

- Merge lanes in a stated order, resolve conflicts keeping both intents, and look for **duplicated implementations** of the same thing across lanes (two agents fixing the same root cause differently is common). Keep one.
- Full test suites and typechecks after the merge, not only per lane.

## Prove it for real

Fakes and mocks are for unit tests. User-facing behaviour is done only after a real run:

- Real models, driven through the real UI path (the same input the user uses), on a hidden or throwaway instance with its own profile and ports.
- Real audio where speech is involved, but only after a safety check: output muted or built-in speakers, no call app using the mic, no other instance listening.
- When quality matters (answers, transcripts), keep a **replay** of a real session and score before/after with a judge. Report the numbers, not adjectives.
- A verify lane that tries to break the change (adversarial) catches what the implementer missed. Parallel verify lanes by angle (replay, functional, code review) beat one generic verifier.
- One fix round for what the verifiers confirm, then re-run only the affected checks.

## The user's machine and data

- Never start, stop or restart the user's own app or processes without asking. Only kill processes that carry your own profile path. If the user is in a meeting or call, pause anything that uses CPU, audio, global shortcuts or windows.
- Secrets: use them from a locked file or the app's own store, never print them, never commit them.
- Private data (recordings, transcripts, personal details) stays out of the repo. If it slipped into commits, squash before pushing.
- Push only when the user asks. Never push to someone else's remote.

## Steering running work

- Running agents can take new instructions by message. Prefer that over killing and restarting; killing loses work and annoys the user.
- When the user changes direction, stop only what is now wasted, and say what was kept.

## Reporting

- Short and concrete: what changed for the user, the before/after numbers, what was tested for real, what was not (for example another OS), and what needs the user's decision.
- Never claim "verified" for a platform or path that was not actually run.
