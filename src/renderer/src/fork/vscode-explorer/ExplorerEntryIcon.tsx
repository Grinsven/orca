import React from 'react'
import { getMaterialFolderIconId } from './material-folder-icon'
import { getSetiFileIconId } from './seti-file-icon'
import './vscode-explorer.css'

type ExplorerEntryIconProps = {
  name: string
  isDirectory: boolean
  isExpanded: boolean
}

/** Seti file-type glyph for files; Seti ships no folder icons, so folders use Material's. */
export function ExplorerEntryIcon({
  name,
  isDirectory,
  isExpanded
}: ExplorerEntryIconProps): React.JSX.Element {
  if (isDirectory) {
    return (
      <span
        aria-hidden
        data-explorer-folder-icon={isExpanded ? 'open' : 'closed'}
        data-material-folder-icon={getMaterialFolderIconId(name, isExpanded)}
        className="inline-flex size-4 shrink-0 items-center justify-center"
      />
    )
  }
  return (
    <span
      aria-hidden
      data-seti-icon={getSetiFileIconId(name)}
      className="inline-flex size-4 shrink-0 items-center justify-center"
    />
  )
}
