export const meta = {
  name: 'measure-fix-verify',
  description:
    'Scope, harness, multi-lens diagnose, skeptic-verified causes, ownership-split fixes, measured E2E loop; all counts scale with complexity',
  phases: [
    { title: 'Scope' },
    { title: 'Harness' },
    { title: 'Diagnose' },
    { title: 'Triage' },
    { title: 'Fix' },
    { title: 'Verify' }
  ]
}
// args: { problem, repo, worktree, branch, base, port, scratch, rules? }
const A = args || {}
// Optional model override for every agent (args.model, e.g. 'opus'); omitted = inherit the session model.
const run = (p, o = {}) => agent(p, A.model ? { model: A.model, ...o } : o)
const BASE = `Work ONLY in git worktree ${A.worktree} (branch ${A.branch}, based on ${A.base}). Other workflows may edit other worktrees concurrently: never edit ${A.repo} or other worktrees (reading is fine). If you launch the app use a fresh temp profile and debug port ${A.port}; only kill processes whose command line contains YOUR profile path. Never push, never print secrets, never start real capture/payments/sends. Commit with 'git add -- <paths>' + 'git commit -m ... -- <paths>' (retry on index.lock). ${A.rules || ''}`
const PROBLEM = `PROBLEM: ${A.problem}`

const SCOPE_SCHEMA = {
  type: 'object',
  required: [
    'subsystems',
    'symptoms',
    'evidence_kind',
    'uncertainty',
    'platforms',
    'lenses',
    'harness_plan'
  ],
  properties: {
    subsystems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'files'],
        properties: {
          name: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    symptoms: { type: 'array', items: { type: 'string' } },
    evidence_kind: { type: 'string', enum: ['measurable', 'judgment', 'mixed'] },
    uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
    platforms: { type: 'array', items: { type: 'string' } },
    lenses: {
      type: 'array',
      items: {
        type: 'object',
        required: ['lens', 'why'],
        properties: { lens: { type: 'string' }, why: { type: 'string' } }
      }
    },
    harness_plan: { type: 'string' }
  }
}
const CAUSES_SCHEMA = {
  type: 'object',
  required: ['causes'],
  properties: {
    causes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'evidence', 'severity', 'files', 'reproduced_by_harness'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          files: { type: 'array', items: { type: 'string' } },
          reproduced_by_harness: { type: 'boolean' }
        }
      }
    }
  }
}
const _VERDICT = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } }
}
const ROUND = {
  type: 'object',
  required: ['green', 'score', 'report'],
  properties: {
    green: { type: 'boolean' },
    score: { type: 'number', description: 'harness assertions passing, 0-100' },
    report: { type: 'string' }
  }
}

phase('Scope')
const scope = await run(
  `${BASE}\n\n${PROBLEM}\n\nRead-only scoping. Identify the subsystems (with key files), distinct symptoms, whether evidence is measurable or judgment, uncertainty, platforms involved, and ONLY the diagnostic lenses that have a concrete reason to apply (choose from: measurement, code-path, user-journey, platform-edge, data-inputs, concurrency-lifecycle, security-privacy, performance, configuration-environment, recent-changes). Propose a harness plan: what to measure, on which real inputs, opt-in flag.`,
  { label: 'scope', phase: 'Scope', schema: SCOPE_SCHEMA }
)

const complexity =
  scope.subsystems.length +
  scope.symptoms.length +
  { low: 0, medium: 2, high: 4 }[scope.uncertainty] +
  (scope.platforms.length > 1 ? 1 : 0)
const maxRounds = 1 // one verify; a second round only ever by explicit request
log(`complexity=${complexity}: ${scope.lenses.length} lenses, up to ${maxRounds} verify rounds`)

phase('Harness')
const harness = await run(
  `${BASE}\n\n${PROBLEM}\n\nHARNESS PLAN: ${scope.harness_plan}\n\nBuild ONE reusable opt-in harness that drives the real code path on real inputs (read-only for user data) and prints numbers plus exact user-facing messages traced to file:line. Run it, commit only the harness, and return: how to run it, and the full output.`,
  { label: 'harness', phase: 'Harness' }
)

phase('Diagnose')
const found = await parallel(
  scope.lenses.map(
    (l) => () =>
      run(
        `${BASE}\n\n${PROBLEM}\n\nHARNESS (reuse it, do not write another):\n${String(harness).slice(0, 12000)}\n\nYou diagnose through the "${l.lens}" lens (${l.why}). Find root causes with concrete evidence (numbers, file:line, reproduction). No fixes.`,
        { label: `diagnose:${l.lens}`, phase: 'Diagnose', schema: CAUSES_SCHEMA }
      )
  )
)

// TRIAGE: one agent merges the lenses' findings by meaning (same cause = fixing
// one mechanism fixes both), drops anything it can show is not real, and keeps
// the rest. No separate skeptic panel: when several independent lenses report
// the same mechanism with harness evidence, voting on it again is waste.
const raw = []
found
  .filter(Boolean)
  .forEach((r, i) =>
    r.causes.forEach((c) =>
      raw.push({ ...c, id: `${scope.lenses[i].lens}:${c.id}`, lens: scope.lenses[i].lens })
    )
  )
const TRIAGED = {
  type: 'object',
  required: ['causes'],
  properties: {
    causes: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'title',
          'evidence',
          'severity',
          'files',
          'reproduced_by_harness',
          'members',
          'real',
          'why'
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          files: { type: 'array', items: { type: 'string' } },
          reproduced_by_harness: { type: 'boolean' },
          members: {
            type: 'array',
            items: { type: 'string' },
            description: 'ids of the raw findings merged into this root cause'
          },
          real: {
            type: 'boolean',
            description:
              'false only when the evidence shows the mechanism is not real / not the cause'
          },
          why: { type: 'string' }
        }
      }
    }
  }
}
phase('Triage')
const triaged = await run(
  `${BASE}\n\n${PROBLEM}\n\nThese ${raw.length} findings come from ${scope.lenses.length} diagnostic lenses and overlap heavily. (1) Merge them into distinct ROOT CAUSES: two findings are the same cause when fixing one mechanism fixes both. Every raw id appears in exactly one merged cause's members; keep the strongest evidence, the union of files, the highest severity, reproduced_by_harness=true if any member was. (2) For each merged cause decide real=true/false: mark false ONLY when you can show (from the code or by a quick harness run) that the mechanism is not real or cannot produce the symptom; when several lenses independently found it with evidence, it is real. Say why in one sentence.\n\nHARNESS: ${String(harness).slice(0, 6000)}\n\nFINDINGS:\n${JSON.stringify(raw).slice(0, 150000)}`,
  { label: 'triage', phase: 'Triage', schema: TRIAGED }
)
const byId = new Map(raw.map((c) => [c.id, c]))
const causes = ((triaged && triaged.causes) || []).map((m) => ({
  ...m,
  lenses: [
    ...new Set((m.members || []).map((id) => byId.get(id) && byId.get(id).lens).filter(Boolean))
  ]
}))
const unassigned = raw.filter((c) => !causes.some((m) => (m.members || []).includes(c.id)))
unassigned.forEach((c) =>
  causes.push({ ...c, lenses: [c.lens], real: true, why: 'not covered by triage; kept' })
)
const confirmed = causes.filter((c) => c.real !== false)
causes.filter((c) => c.real === false).forEach((c) => log(`dropped: ${c.title} , ${c.why}`))
log(`${raw.length} findings -> ${causes.length} root causes, ${confirmed.length} to fix`)

phase('Fix')
// ownership clusters: union-find over causes sharing files
const parent = confirmed.map((_, i) => i)
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
confirmed.forEach((a, i) =>
  confirmed.forEach((b, j) => {
    if (j > i && a.files.some((f) => b.files.includes(f))) {
      parent[find(j)] = find(i)
    }
  })
)
const clusters = {}
confirmed.forEach((c, i) => (clusters[find(i)] ||= []).push(c))
const owned = Object.values(clusters)
log(
  `${confirmed.length} confirmed causes -> ${owned.length} fixers (coverage ${owned.flat().length}/${confirmed.length})`
)
const fixes = await parallel(
  owned.map(
    (cs, k) => () =>
      run(
        `${BASE}\n\n${PROBLEM}\n\nYou OWN these files: ${[...new Set(cs.flatMap((c) => c.files))].join(', ')} (plus new tests beside them). Fix these confirmed root causes at the root:\n${JSON.stringify(cs, null, 1)}\n\nOther fixers change adjacent interfaces concurrently: consume them defensively; for files you don't own, write requests to ${A.scratch}/requests-${k}.md instead of editing. Add tests (both platform branches where platform logic is involved), commit small logical commits.`,
        { label: `fix:${k + 1}/${owned.length}`, phase: 'Fix' }
      )
  )
)

phase('Verify')
let prev = -1,
  last = null
for (let r = 1; r <= maxRounds; r++) {
  last = await run(
    `${BASE}\n\n${PROBLEM}\n\nFixer reports: ${JSON.stringify(fixes).slice(0, 12000)}\nRequests for shared files: ${A.scratch}/requests-*.md\nPrevious round: ${last ? last.report.slice(0, 4000) : 'none'}\n\nVERIFY ROUND ${r}: apply shared-file requests, reconcile drift (typecheck, build, unit tests), rerun the SAME harness and app-level E2E, fix remaining failures at the root, commit. Report green only if every harness assertion and the E2E pass; score = percentage of harness assertions passing; include a before/after table.`,
    { label: `verify:${r}`, phase: 'Verify', schema: ROUND }
  )
  if (!last || last.green) {
    break
  }
  if (last.score <= prev) {
    log(`no progress in round ${r} (score ${last.score}); stopping`)
    break
  }
  prev = last.score
}
return {
  scope,
  causes: causes.length,
  confirmed: confirmed.map((c) => c.title),
  refuted: causes.filter((c) => c.real === false).map((c) => c.title),
  final: last
}
