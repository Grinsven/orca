import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_ROW_MOTION, ease3, EASE3_CSS, prefersReducedMotion } from '@/fork/diri-motion/motion'

export type AgentRowPresencePhase = 'present' | 'entering' | 'leaving'

type PresenceRun = {
  animation: Animation
  from: number
  to: number
  durationMs: number
}

/** How much of the row shows, 0 to 1, `localTimeMs` into a run on ease3. */
export function samplePresence(run: Omit<PresenceRun, 'animation'>, localTimeMs: number): number {
  return run.from + (run.to - run.from) * ease3(localTimeMs / run.durationMs)
}

/**
 * Grows a row in or shrinks it out with its height (a grid track, as the compact agent
 * expansion does) and opacity, so its card resizes smoothly instead of snapping. A phase
 * change mid-run starts from what is showing.
 */
export function AgentRowPresence({
  phase,
  onExited,
  children
}: {
  phase: AgentRowPresencePhase
  onExited?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const runRef = useRef<PresenceRun | null>(null)
  const mountedRef = useRef(false)
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited

  useLayoutEffect(() => {
    const element = ref.current
    const firstPhase = !mountedRef.current
    mountedRef.current = true
    const to = phase === 'leaving' ? 0 : 1
    const run = runRef.current
    if (!element || run?.to === to || (firstPhase && phase === 'present')) {
      return
    }
    const time = run?.animation.currentTime
    const shown = run
      ? samplePresence(run, typeof time === 'number' ? time : 0)
      : firstPhase && phase === 'entering'
        ? 0
        : 1
    run?.animation.cancel()
    runRef.current = null
    if (shown === to || prefersReducedMotion() || typeof element.animate !== 'function') {
      element.removeAttribute('data-agent-row-motion')
      if (to === 0) {
        onExitedRef.current?.()
      }
      return
    }
    const durationMs = to === 1 ? AGENT_ROW_MOTION.inMs : AGENT_ROW_MOTION.outMs
    // Why the margin: a flex gap beside a row would otherwise stay until the row unmounts.
    const parent = element.parentElement
    const gap = parent ? Number.parseFloat(getComputedStyle(parent).rowGap) || 0 : 0
    const from = {
      gridTemplateRows: `${shown}fr`,
      opacity: shown,
      marginBottom: `${-gap * (1 - shown)}px`
    }
    const gone = { gridTemplateRows: '0fr', opacity: 0, marginBottom: `${-gap}px` }
    // Why fill forwards out: the row holds at nothing until its owner unmounts it.
    const animation = element.animate(to === 1 ? [{ ...from, offset: 0 }] : [from, gone], {
      duration: durationMs,
      easing: EASE3_CSS,
      fill: to === 1 ? 'none' : 'forwards'
    })
    const next: PresenceRun = { animation, from: shown, to, durationMs }
    runRef.current = next
    element.setAttribute('data-agent-row-motion', '')
    animation.onfinish = () => {
      if (runRef.current !== next) {
        return
      }
      if (to === 1) {
        runRef.current = null
        element.removeAttribute('data-agent-row-motion')
      } else {
        onExitedRef.current?.()
      }
    }
  }, [phase])

  // Why reset mounted: a remount (StrictMode's included) must replay the entrance, not skip it.
  useLayoutEffect(
    () => () => {
      runRef.current?.animation.cancel()
      runRef.current = null
      mountedRef.current = false
    },
    []
  )

  return (
    <div ref={ref} data-agent-row-presence="" inert={phase === 'leaving'}>
      <div>{children}</div>
    </div>
  )
}

type LeavingRow<T> = { item: T; index: number }

/** Renders agent rows keyed by pane; a row that appears grows in, one that goes shrinks out. */
export function AgentRowPresenceList<T extends { paneKey: string }>({
  items,
  render
}: {
  items: readonly T[]
  render: (item: T) => React.ReactNode
}): React.JSX.Element {
  // Why a ref: the render that adds a row must already know it is new, before any effect runs.
  const previousRef = useRef(items)
  const [leaving, setLeaving] = useState<ReadonlyMap<string, LeavingRow<T>>>(() => new Map())
  const previousKeys = new Set(previousRef.current.map((item) => item.paneKey))
  const currentKeys = new Set(items.map((item) => item.paneKey))

  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = items
    const keys = new Set(items.map((item) => item.paneKey))
    setLeaving((current) => {
      let changed = false
      const next = new Map<string, LeavingRow<T>>()
      current.forEach((row, key) => {
        if (keys.has(key)) {
          changed = true
        } else {
          next.set(key, row)
        }
      })
      previous.forEach((item, index) => {
        if (!keys.has(item.paneKey)) {
          next.set(item.paneKey, { item, index })
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [items])

  const onExited = useCallback((key: string) => {
    setLeaving((current) => {
      const next = new Map(current)
      next.delete(key)
      return next
    })
  }, [])

  const rows = items.map((item) => ({
    item,
    key: item.paneKey,
    leaving: false
  }))
  leaving.forEach((row, key) => {
    if (!currentKeys.has(key)) {
      rows.splice(Math.min(row.index, rows.length), 0, {
        item: row.item,
        key,
        leaving: true
      })
    }
  })
  return (
    <>
      {rows.map((row) => (
        <AgentRowPresence
          key={row.key}
          phase={row.leaving ? 'leaving' : previousKeys.has(row.key) ? 'present' : 'entering'}
          onExited={row.leaving ? () => onExited(row.key) : undefined}
        >
          {render(row.item)}
        </AgentRowPresence>
      ))}
    </>
  )
}

/**
 * The card's whole agent list: grows in when the first agent starts and stays painted while
 * the last one shrinks out.
 */
export function useAgentListPresence<A extends readonly unknown[]>(
  agents: A
): {
  agents: A
  phase: AgentRowPresencePhase
  onExited: () => void
} {
  // Why a ref: the commit that empties the list must still paint it until the exit starts.
  const lastShownRef = useRef(agents)
  const [exiting, setExiting] = useState<A | null>(null)

  useLayoutEffect(() => {
    const previous = lastShownRef.current
    lastShownRef.current = agents
    if (agents.length > 0) {
      setExiting(null)
    } else if (previous.length > 0) {
      setExiting(previous)
    }
  }, [agents])

  const onExited = useCallback(() => setExiting(null), [])
  const wasEmpty = lastShownRef.current.length === 0
  if (agents.length > 0) {
    return { agents, phase: wasEmpty ? 'entering' : 'present', onExited }
  }
  return {
    agents: exiting ?? lastShownRef.current,
    phase: exiting ? 'leaving' : 'present',
    onExited
  }
}
