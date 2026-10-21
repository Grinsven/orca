// Pierre's headers live in shadow roots, so clicks are read from the composed path.
export type ChangesHeaderTarget = { kind: 'title' | 'header'; path: string }

function hasAttribute(node: EventTarget, name: string): node is Element {
  return node instanceof Element && node.hasAttribute(name)
}

export function findChangesHeaderTarget(event: Event): ChangesHeaderTarget | null {
  const path = event.composedPath()
  for (const node of path) {
    // Header buttons (collapse, copy, load) keep their own click.
    if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) {
      return null
    }
  }
  const title = path.find((node) => hasAttribute(node, 'data-title'))
  if (title) {
    const filePath = title.textContent?.trim()
    return filePath ? { kind: 'title', path: filePath } : null
  }
  const header = path.find((node) => hasAttribute(node, 'data-diffs-header'))
  const filePath = header?.querySelector('[data-title]')?.textContent?.trim()
  return filePath ? { kind: 'header', path: filePath } : null
}
