const CLAIM_RETRY_BASE_MS = 1_000
/** Retries after a failed claim before its seeding waiters are refused. */
export const CLAIM_RETRY_LIMIT = 3

/**
 * A claim that fails in transport (not a refusal, not a missing method) is retried with backoff
 * while the stream stays up; once the retries run out, the waiters on it are refused so seeding
 * never proceeds on an uncertain claim and never waits forever.
 */
export function createClaimRetry(deps: {
  setTimer: (callback: () => void, ms: number) => () => void
  retry: () => void
  giveUp: (key: string) => void
}): { failed: (key: string | null) => void; succeeded: () => void; cancel: () => void } {
  let failures = 0
  let cancelTimer: (() => void) | null = null
  const cancel = (): void => {
    cancelTimer?.()
    cancelTimer = null
  }
  return {
    failed: (key) => {
      cancel()
      failures += 1
      if (failures > CLAIM_RETRY_LIMIT) {
        failures = 0
        if (key !== null) {
          deps.giveUp(key)
        }
        return
      }
      cancelTimer = deps.setTimer(
        () => {
          cancelTimer = null
          deps.retry()
        },
        CLAIM_RETRY_BASE_MS * 2 ** (failures - 1)
      )
    },
    succeeded: () => {
      failures = 0
      cancel()
    },
    cancel: () => {
      failures = 0
      cancel()
    }
  }
}
