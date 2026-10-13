import { createSecondWindowMenuItems } from '../fork/second-window/second-window-menu-item'
export function createAppWindowMenu(
  label: string,
  isMac: boolean
): Electron.MenuItemConstructorOptions {
  return {
    label,
    submenu: [
      ...createSecondWindowMenuItems(),
      {
        // Why: Electron's minimize role otherwise steals Ctrl+M from terminal apps such as Crush.
        role: 'minimize',
        ...(isMac ? {} : { accelerator: '', registerAccelerator: false })
      },
      { role: 'zoom' }
    ]
  }
}
