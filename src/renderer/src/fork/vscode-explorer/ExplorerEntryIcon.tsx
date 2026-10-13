import React from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { getSetiFileIconId } from './seti-file-icon'
import './vscode-explorer.css'

type ExplorerEntryIconProps = {
  name: string
  isDirectory: boolean
  isExpanded: boolean
}

/** Seti file-type glyph for files; Seti ships no folder glyphs, so folders keep lucide's. */
export function ExplorerEntryIcon({
  name,
  isDirectory,
  isExpanded
}: ExplorerEntryIconProps): React.JSX.Element {
  if (isDirectory) {
    const FolderIcon = isExpanded ? FolderOpen : Folder
    return (
      <span data-explorer-folder-icon={isExpanded ? 'open' : 'closed'} className="explorer-icon">
        <FolderIcon className="size-3.5 text-muted-foreground" />
      </span>
    )
  }
  return <span aria-hidden data-seti-icon={getSetiFileIconId(name)} className="explorer-icon" />
}
