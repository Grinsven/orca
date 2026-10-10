import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const REPO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Orca',
    usage: 'orca repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Orca by filesystem path',
    usage: 'orca repo add --path <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'orca repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set'],
    summary: "Set a repo's worktree visibility or project map",
    usage:
      'orca repo set --repo <selector> [--external-worktree-visibility show|hide|inherit] [--project-map <path>|null] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'external-worktree-visibility', 'project-map'],
    notes: [
      'show and hide override the global non-Orca worktree visibility default for this repo; inherit clears the override.',
      'Per-worktree visibility rules still apply.',
      '--project-map takes an absolute .html or .htm path on the repo host, which may be outside the repo; the sidebar then shows a Project map button for it. null clears it.'
    ],
    examples: [
      'orca repo set --repo path:/path/to/repo --external-worktree-visibility show --json',
      'orca repo set --repo path:/path/to/repo --project-map /path/to/repo/docs/map.html --json'
    ]
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'orca repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'orca repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  }
]
