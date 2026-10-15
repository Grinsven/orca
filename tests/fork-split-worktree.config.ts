import { defineConfig } from '@stablyai/playwright-test'
import base from './playwright.config'

/** Uses the normal isolated fixtures with already-built artifacts and no global CLI install. */
export default defineConfig({
  ...base,
  globalSetup: undefined,
  globalTeardown: undefined,
  workers: 1,
  projects: base.projects?.map((project) => ({
    ...project,
    testMatch: 'fork-split-worktree.spec.ts'
  })),
  testMatch: 'fork-split-worktree.spec.ts'
})
