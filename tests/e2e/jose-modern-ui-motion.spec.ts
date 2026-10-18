import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { configureRendererScaleFixture } from '../../config/scripts/idle-cpu-renderer-scale-fixture.mjs'

test.use({ minimumSeededWorktreeCount: 1 })

test('Modern UI interpolates working indicators and preserves reduced motion', async ({
  orcaPage,
  testRepoPath
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await configureRendererScaleFixture(
    orcaPage,
    { agentsPerWorktree: 1, subagentsPerAgent: 0, lineageDepth: 0 },
    testRepoPath
  )
  const observations: {
    modernUi: boolean
    reducedMotion: 'no-preference' | 'reduce'
    angles: number[]
    animationCount: number
    fullRing: boolean
  }[] = []
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await orcaPage.emulateMedia({ reducedMotion })
    for (const modernUi of [true, false]) {
      await orcaPage.evaluate(async (enabled) => {
        await window.__store!.getState().updateSettingsOrThrow({ modernUi: enabled })
      }, modernUi)
      await orcaPage.waitForFunction(
        (enabled) => (document.documentElement.dataset.modernUi === 'on') === enabled,
        modernUi
      )
      const spinner = orcaPage.locator('[data-worktree-sidebar] [data-agent-spinner]').first()
      await spinner.waitFor({ state: 'visible' })
      observations.push({
        modernUi,
        reducedMotion,
        ...(await spinner.evaluate(async (element) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const animation = element
            .getAnimations()
            .find(
              (candidate) =>
                candidate instanceof CSSAnimation &&
                candidate.animationName === 'agent-spinner-rotate'
            )
          const angles: number[] = []
          if (animation) {
            animation.pause()
            await animation.ready
            for (const time of [20, 40]) {
              animation.currentTime = time
              const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
              angles.push(Math.round(((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI) * 10) / 10)
            }
          }
          const style = getComputedStyle(element)
          return {
            angles,
            animationCount: element.getAnimations().length,
            fullRing: style.borderTopColor === style.borderRightColor
          }
        }))
      })
    }
  }

  expect(observations).toEqual([
    {
      modernUi: true,
      reducedMotion: 'no-preference',
      angles: [7.2, 14.4],
      animationCount: 1,
      fullRing: false
    },
    {
      modernUi: false,
      reducedMotion: 'no-preference',
      angles: [0, 0],
      animationCount: 1,
      fullRing: false
    },
    {
      modernUi: true,
      reducedMotion: 'reduce',
      angles: [],
      animationCount: 0,
      fullRing: true
    },
    {
      modernUi: false,
      reducedMotion: 'reduce',
      angles: [],
      animationCount: 0,
      fullRing: true
    }
  ])
})
