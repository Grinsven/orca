import type { KeyboardEvent } from 'react'

/** Activates the row through its existing click path, without intercepting nested actions. */
export function activateSourceControlRow(event: KeyboardEvent<HTMLDivElement>): void {
  if (
    event.target !== event.currentTarget ||
    event.nativeEvent.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  event.currentTarget.click()
}
