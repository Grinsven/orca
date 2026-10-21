// Adapted from T3 Code (github.com/pingdotgg/t3code, MIT, Copyright (c) 2026 T3 Tools Inc.)
import { WorkerPoolContext, useWorkerPool } from '@pierre/diffs/react'
import { WorkerPoolManager } from '@pierre/diffs/worker'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

export type ChangesDiffThemeName = 'pierre-light' | 'pierre-dark'

// Shiki runs in these workers, so highlighting never blocks scrolling on the main thread.
export const CHANGES_DIFF_HIGHLIGHTER = 'shiki-wasm'
const DIFF_WORKER_IDLE_TTL_MS = 30_000

function resolveDiffWorkerPoolSize(): number {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4)
  return Math.max(2, Math.min(6, Math.floor(cores / 2)))
}

type SharedPool = {
  readonly pool: WorkerPoolManager
  consumers: number
  idleTimer: ReturnType<typeof setTimeout> | undefined
}
let sharedWorkerPool: SharedPool | undefined

function acquireDiffWorkerPool(themeName: ChangesDiffThemeName, poolSize: number): SharedPool {
  const entry = (sharedWorkerPool ??= {
    pool: new WorkerPoolManager(
      { workerFactory: () => new DiffsWorker(), poolSize, totalASTLRUCacheSize: 240 },
      {
        theme: themeName,
        preferredHighlighter: CHANGES_DIFF_HIGHLIGHTER,
        tokenizeMaxLineLength: 1_000,
        useTokenTransformer: true
      }
    ),
    consumers: 0,
    idleTimer: undefined
  })
  clearTimeout(entry.idleTimer)
  entry.idleTimer = undefined
  entry.consumers += 1
  return entry
}

function DiffWorkerThemeSync({ themeName }: { themeName: ChangesDiffThemeName }): null {
  const workerPool = useWorkerPool()
  useEffect(() => {
    if (!workerPool) {
      return
    }
    void (async () => {
      try {
        const current = workerPool.getDiffRenderOptions()
        if (current.theme !== themeName) {
          await workerPool.setRenderOptions({ ...current, theme: themeName })
        }
      } catch (error) {
        console.error('Diff worker theme update failed.', error)
      }
    })()
  }, [themeName, workerPool])
  return null
}

// Why: a highlight task queued before the pool is up can retry into a blank first render.
function DiffWorkerReady({ children }: { children?: ReactNode }): ReactNode {
  const workerPool = useWorkerPool()
  const [readyPool, setReadyPool] = useState<WorkerPoolManager>()
  const ready = workerPool
    ? readyPool === workerPool || workerPool.isInitialized() || !workerPool.isWorkingPool()
    : false

  useEffect(() => {
    if (ready || !workerPool) {
      return
    }
    let mounted = true
    const finish = (): void => {
      if (mounted) {
        setReadyPool(workerPool)
      }
    }
    void workerPool.initialize().then(finish, finish)
    return () => {
      mounted = false
    }
  }, [ready, workerPool])

  return ready ? (
    children
  ) : (
    <div
      role="status"
      className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-muted-foreground"
    >
      Loading code…
    </div>
  )
}

export function ChangesDiffWorkerPoolProvider({
  themeName,
  children
}: {
  themeName: ChangesDiffThemeName
  children?: ReactNode
}): React.JSX.Element {
  const [poolSize] = useState(resolveDiffWorkerPoolSize)
  // Why: the pool is shared and outlives one view for 30 s, so reopening a tab skips worker startup.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const entry = acquireDiffWorkerPool(themeName, poolSize)
      onStoreChange()
      return () => {
        entry.consumers -= 1
        if (entry.consumers !== 0) {
          return
        }
        entry.idleTimer = setTimeout(() => {
          entry.idleTimer = undefined
          entry.pool.terminate()
          if (sharedWorkerPool === entry) {
            sharedWorkerPool = undefined
          }
        }, DIFF_WORKER_IDLE_TTL_MS)
      }
    },
    [themeName, poolSize]
  )
  const workerPool = useSyncExternalStore(subscribe, () => sharedWorkerPool?.pool)

  return (
    <WorkerPoolContext value={workerPool}>
      <DiffWorkerThemeSync themeName={themeName} />
      <DiffWorkerReady>{children}</DiffWorkerReady>
    </WorkerPoolContext>
  )
}
