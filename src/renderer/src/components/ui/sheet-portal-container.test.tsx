// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Sheet, SheetContent, SheetTitle } from './sheet'

afterEach(cleanup)

it('portals both the sheet and its overlay into the supplied style scope', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  try {
    render(
      <Sheet open>
        <SheetContent portalContainer={container} aria-describedby={undefined}>
          <SheetTitle>Drawer</SheetTitle>
        </SheetContent>
      </Sheet>
    )

    expect([
      container.contains(document.querySelector('[data-slot="sheet-content"]')),
      container.contains(document.querySelector('[data-slot="sheet-overlay"]'))
    ]).toEqual([true, true])
  } finally {
    cleanup()
    container.remove()
  }
})
