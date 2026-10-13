const SLOT_SUFFIX_PATTERN = /-window-\d+$/

/** True for a New Window slot profile (`orca-window-2`, `orca-dev-window-3`, ...).
 *  Why no node:path: the sandboxed preload reads this and cannot load node modules. */
export function isSecondWindowSlotUserDataPath(userDataPath: string | undefined): boolean {
  const lastSegment =
    (userDataPath ?? '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  return SLOT_SUFFIX_PATTERN.test(lastSegment)
}
