// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSidebarDrawerPortal } from './use-sidebar-drawer-portal'

afterEach(cleanup)

describe('sidebar drawer portal', () => {
  it('retains draft widths without publishing React state or changing the document root', () => {
    const rootWidth = document.documentElement.style.getPropertyValue(
      '--workspace-sidebar-live-width'
    )
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useSidebarDrawerPortal(220)
    })
    const before = renders
    const container = result.current.portalContainer
    act(() => {
      result.current.setLiveSidebarWidth(260)
      result.current.setLiveSidebarWidth(320)
    })

    expect({
      connected: container?.isConnected,
      parent: container?.parentElement,
      draftWidth: container?.style.getPropertyValue('--workspace-sidebar-live-width'),
      rootWidth: document.documentElement.style.getPropertyValue('--workspace-sidebar-live-width'),
      renders
    }).toEqual({
      connected: true,
      parent: document.body,
      draftWidth: '320px',
      rootWidth,
      renders: before
    })
  })

  it('keeps its callback stable and removes its host on unmount', () => {
    const { result, rerender, unmount } = renderHook(() => useSidebarDrawerPortal(220))
    const container = result.current.portalContainer
    const setWidth = result.current.setLiveSidebarWidth
    rerender()
    const stable = setWidth === result.current.setLiveSidebarWidth
    unmount()
    setWidth(400)

    expect({
      stable,
      connected: container?.isConnected,
      hosts: document.querySelectorAll('[data-sidebar-drawer-portal]').length
    }).toEqual({ stable: true, connected: false, hosts: 0 })
  })
})
