import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi, type Mock } from 'vitest'

type FakeMainWindow = { webContents: { isDestroyed: () => boolean; send: Mock } }

const { openSecondWindowMock, mainProcessState } = vi.hoisted(() => {
  const state: { mainWindow: FakeMainWindow | null } = { mainWindow: null }
  return { openSecondWindowMock: vi.fn(async () => 'recorded' as const), mainProcessState: state }
})

vi.mock('./open-second-window', () => ({ openSecondWindow: openSecondWindowMock }))
vi.mock('../../startup/main-process-state', () => ({ mainProcessState }))

import {
  createSecondWindowMenuItems,
  NEW_ORCA_WINDOW_MENU_ITEM_ID,
  openSecondWindowFromMenu,
  requestNewWindowFromHost
} from './second-window-menu-item'

const hostProfile = join(tmpdir(), 'orca')

describe('createSecondWindowMenuItems', () => {
  it('adds New Window above a separator for the desktop app', () => {
    const items = createSecondWindowMenuItems(['/Orca', '--inspect'], hostProfile)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: NEW_ORCA_WINDOW_MENU_ITEM_ID,
      label: 'New Window',
      click: openSecondWindowFromMenu
    })
    expect(items[1]).toEqual({ type: 'separator' })
  })

  it('opens a second window when clicked', async () => {
    openSecondWindowFromMenu()
    await vi.waitFor(() => expect(openSecondWindowMock).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['--serve flag', ['/Orca', '--serve']],
    ['serve subcommand', ['/Orca', 'serve', '--port', '6768']]
  ])('is hidden in headless serve (%s)', (_, argv) => {
    expect(createSecondWindowMenuItems(argv, hostProfile)).toEqual([])
  })

  it('in a window that is itself a slot, forwards New Window to the host through its renderer', () => {
    const send = vi.fn()
    mainProcessState.mainWindow = { webContents: { isDestroyed: () => false, send } }
    openSecondWindowMock.mockClear()
    const [item] = createSecondWindowMenuItems(['/Orca'], join(tmpdir(), 'orca-window-2'))
    requestNewWindowFromHost()
    mainProcessState.mainWindow = null

    expect({
      id: item?.id,
      forwards: item?.click === requestNewWindowFromHost,
      sent: send.mock.calls,
      openedHere: openSecondWindowMock.mock.calls.length
    }).toEqual({
      id: NEW_ORCA_WINDOW_MENU_ITEM_ID,
      forwards: true,
      sent: [['joseWindow:openWindowRequested']],
      openedHere: 0
    })
  })
})
