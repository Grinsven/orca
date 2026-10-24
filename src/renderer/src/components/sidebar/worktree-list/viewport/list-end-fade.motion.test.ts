// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { SIDEBAR_CARD_MOTION_VARS } from '@/fork/diri-motion/motion'
import {
  createListTopFadeWriter,
  getPinnedHeaderInset,
  getWorktreeListMotionStyle,
  WORKTREE_LIST_FADE_STYLE
} from './list-end-fade'

describe('sidebar list end fade', () => {
  it('shows no top fade unscrolled and ramps it in over the first 14 px', () => {
    const target = document.createElement('div')
    const writes: string[] = []
    const setProperty = target.style.setProperty.bind(target.style)
    target.style.setProperty = (name: string, value: string | null) => {
      writes.push(`${name}=${value}`)
      setProperty(name, value)
    }
    const write = createListTopFadeWriter()
    for (const scrollTop of [0, 7, 14, 30, 300, 0]) {
      write(target, scrollTop)
    }
    // Past the ramp the strength stays 1, so scrolling further writes nothing.
    expect(writes).toEqual([
      '--list-top-fade=0',
      '--list-top-fade=0.5',
      '--list-top-fade=1',
      '--list-top-fade=0'
    ])
  })

  it('starts the top fade below pinned headers so it never dims them', () => {
    expect(getPinnedHeaderInset(false, false)).toBe(0)
    expect(getPinnedHeaderInset(false, true)).toBe(27)
    expect(getPinnedHeaderInset(true, false)).toBe(35)
    expect(getPinnedHeaderInset(true, true)).toBe(63)
    expect(getWorktreeListMotionStyle(27)).toEqual({
      ...SIDEBAR_CARD_MOTION_VARS,
      '--list-fade-inset': '27px'
    })
  })

  it('masks the list and the fold overlay with the same 28 px end fades', () => {
    expect(WORKTREE_LIST_FADE_STYLE.maskImage).toContain(
      'black calc(100% - 28px), transparent 100%'
    )
    expect(WORKTREE_LIST_FADE_STYLE.maskImage).toContain('calc(var(--list-fade-inset, 0px) + 28px)')
  })
})
