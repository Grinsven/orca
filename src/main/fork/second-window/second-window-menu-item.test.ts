import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

const { openSecondWindowMock } = vi.hoisted(() => ({
  openSecondWindowMock: vi.fn(async () => 'recorded' as const)
}))

vi.mock('./open-second-window', () => ({ openSecondWindow: openSecondWindowMock }))

import {
  createSecondWindowMenuItems,
  NEW_ORCA_WINDOW_MENU_ITEM_ID
} from './second-window-menu-item'

const hostProfile = join(tmpdir(), 'orca')

describe('createSecondWindowMenuItems', () => {
  it('adds New Window above a separator for the desktop app', async () => {
    const items = createSecondWindowMenuItems(['/Orca', '--inspect'], hostProfile)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: NEW_ORCA_WINDOW_MENU_ITEM_ID, label: 'New Window' })
    expect(items[1]).toEqual({ type: 'separator' })

    items[0]?.click?.({} as never, undefined, {} as never)
    await vi.waitFor(() => expect(openSecondWindowMock).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['--serve flag', ['/Orca', '--serve']],
    ['serve subcommand', ['/Orca', 'serve', '--port', '6768']]
  ])('is hidden in headless serve (%s)', (_, argv) => {
    expect(createSecondWindowMenuItems(argv, hostProfile)).toEqual([])
  })

  it('is hidden inside a window that is itself a slot', () => {
    expect(createSecondWindowMenuItems(['/Orca'], join(tmpdir(), 'orca-window-2'))).toEqual([])
  })
})
