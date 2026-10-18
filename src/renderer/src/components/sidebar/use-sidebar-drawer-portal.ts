import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const SIDEBAR_WIDTH_PROPERTY = '--workspace-sidebar-live-width'

/** Keeps live drawer geometry outside the rest of the document's style subtree. */
export function useSidebarDrawerPortal(initialWidth: number) {
  const liveWidthRef = useRef(initialWidth)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  const setLiveSidebarWidth = useCallback((width: number) => {
    liveWidthRef.current = width
    const container = containerRef.current
    if (!container) {
      return
    }
    const value = `${width}px`
    if (container.style.getPropertyValue(SIDEBAR_WIDTH_PROPERTY) !== value) {
      container.style.setProperty(SIDEBAR_WIDTH_PROPERTY, value)
    }
  }, [])

  useLayoutEffect(() => {
    const container = document.createElement('div')
    container.dataset.sidebarDrawerPortal = ''
    container.style.setProperty(SIDEBAR_WIDTH_PROPERTY, `${liveWidthRef.current}px`)
    document.body.appendChild(container)
    containerRef.current = container
    setPortalContainer(container)
    return () => {
      if (containerRef.current === container) {
        containerRef.current = null
      }
      container.remove()
    }
  }, [])

  return { portalContainer, setLiveSidebarWidth }
}
