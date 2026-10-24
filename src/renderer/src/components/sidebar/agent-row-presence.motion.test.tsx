// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordElementAnimations,
  stubReducedMotion,
  type RecordedAnimation
} from '@/fork/diri-motion/motion-test-animations'
import { AgentRowPresence, AgentRowPresenceList, useAgentListPresence } from './agent-row-presence'

type Agent = { paneKey: string }

function agents(...keys: string[]): Agent[] {
  return keys.map((paneKey) => ({ paneKey }))
}

function AgentList({ items }: { items: Agent[] }): React.JSX.Element {
  return (
    <AgentRowPresenceList
      items={items}
      render={(agent) => <span data-agent={agent.paneKey}>{agent.paneKey}</span>}
    />
  )
}

function CardAgents({ items }: { items: Agent[] }): React.JSX.Element | null {
  const presence = useAgentListPresence(items)
  if (presence.agents.length === 0) {
    return null
  }
  return (
    <AgentRowPresence phase={presence.phase} onExited={presence.onExited}>
      <AgentList items={presence.agents} />
    </AgentRowPresence>
  )
}

let root: Root
let container: HTMLDivElement
let animations: RecordedAnimation[] = []

function render(node: React.ReactNode): void {
  act(() => root.render(node))
}

function shown(): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-agent]')).map(
    (element) => element.dataset.agent ?? ''
  )
}

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  animations = recordElementAnimations()
  stubReducedMotion(false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('agent rows in a card', () => {
  it('rows already there on first paint do not animate', () => {
    render(<AgentList items={agents('a', 'b')} />)
    expect(shown()).toEqual(['a', 'b'])
    expect(animations).toHaveLength(0)
  })

  it('a row that appears fades and grows in over 220 ms on ease3', () => {
    render(<AgentList items={agents('a')} />)
    render(<AgentList items={agents('a', 'b')} />)
    expect(animations).toHaveLength(1)
    const [grow] = animations
    expect(grow?.element.textContent).toBe('b')
    expect(grow?.keyframes).toEqual([
      { gridTemplateRows: '0fr', opacity: 0, marginBottom: '0px', offset: 0 }
    ])
    expect(grow?.options).toMatchObject({
      duration: 220,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)'
    })
    expect(grow?.element.hasAttribute('data-agent-row-motion')).toBe(true)
    act(() => grow?.finish())
    expect(grow?.element.hasAttribute('data-agent-row-motion')).toBe(false)
  })

  it('a row that goes stays painted while it fades and shrinks out over 200 ms', () => {
    render(<AgentList items={agents('a', 'b', 'c')} />)
    render(<AgentList items={agents('a', 'c')} />)
    expect(shown()).toEqual(['a', 'b', 'c'])
    const [shrink] = animations
    expect(shrink?.keyframes).toEqual([
      { gridTemplateRows: '1fr', opacity: 1, marginBottom: '0px' },
      { gridTemplateRows: '0fr', opacity: 0, marginBottom: '0px' }
    ])
    expect(shrink?.options).toMatchObject({ duration: 200, fill: 'forwards' })
    expect(shrink?.element.hasAttribute('inert')).toBe(true)
    act(() => shrink?.finish())
    expect(shown()).toEqual(['a', 'c'])
  })

  it('a row that comes back mid-exit grows from what is showing', () => {
    render(<AgentList items={agents('a', 'b')} />)
    render(<AgentList items={agents('a')} />)
    const [shrink] = animations
    if (shrink) {
      shrink.currentTime = 100
    }
    render(<AgentList items={agents('a', 'b')} />)
    expect(shrink?.cancelled).toBe(true)
    const regrow = animations.at(-1)
    expect(regrow?.keyframes[0]).toMatchObject({ gridTemplateRows: '0.125fr', opacity: 0.125 })
    expect(shown()).toEqual(['a', 'b'])
  })

  it('the first agent grows the list in and the last one shrinks it out', () => {
    render(<CardAgents items={[]} />)
    expect(container.childElementCount).toBe(0)
    render(<CardAgents items={agents('a')} />)
    expect(animations).toHaveLength(1)
    expect(animations[0]?.keyframes[0]).toMatchObject({ gridTemplateRows: '0fr', opacity: 0 })
    act(() => {
      if (animations[0]) {
        animations[0].currentTime = 220
        animations[0].finish()
      }
    })
    render(<CardAgents items={[]} />)
    expect(shown()).toEqual(['a'])
    const shrink = animations.at(-1)
    expect(shrink?.keyframes.at(-1)).toMatchObject({ gridTemplateRows: '0fr', opacity: 0 })
    act(() => shrink?.finish())
    expect(container.childElementCount).toBe(0)
  })

  it('lands at once under Reduce Motion', () => {
    stubReducedMotion(true)
    render(<CardAgents items={agents('a', 'b')} />)
    render(<CardAgents items={agents('a')} />)
    expect(shown()).toEqual(['a'])
    render(<CardAgents items={[]} />)
    expect(container.childElementCount).toBe(0)
    expect(animations).toHaveLength(0)
  })
})
