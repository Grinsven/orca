import { useState } from 'react'
import { useAppStore } from '@/store'
import { combinedDiffViewPreferences } from '@/components/editor/combined-diff/remember-view/combined-diff-view-memory'
import type { ChangesViewLayout } from './changes-view-toolbar'

export type ChangesViewPreferences = {
  layout: ChangesViewLayout
  setLayout: (layout: ChangesViewLayout) => void
  wordWrap: boolean
  setWordWrap: (wordWrap: boolean) => void
  ignoreWhitespace: boolean
  setIgnoreWhitespace: (ignore: boolean) => void
  fileTreeOpen: boolean
  setFileTreeOpen: (open: boolean) => void
}

// Same settings and session memory as Orca's Monaco "View all", so switching back keeps the choices.
export function useChangesViewPreferences(): ChangesViewPreferences {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [pickedLayout, setPickedLayout] = useState<ChangesViewLayout | null>(() =>
    combinedDiffViewPreferences.sideBySide === null
      ? null
      : combinedDiffViewPreferences.sideBySide
        ? 'split'
        : 'stacked'
  )
  const [pickedTreeOpen, setPickedTreeOpen] = useState<boolean | null>(() =>
    combinedDiffViewPreferences.fileTreeCollapsed === null
      ? null
      : !combinedDiffViewPreferences.fileTreeCollapsed
  )
  const layout =
    pickedLayout ?? (settings?.diffDefaultView === 'side-by-side' ? 'split' : 'stacked')

  return {
    layout,
    setLayout: (next) => {
      combinedDiffViewPreferences.sideBySide = next === 'split'
      setPickedLayout(next)
    },
    wordWrap: settings?.diffWordWrap === true,
    setWordWrap: (wordWrap) => void updateSettings({ diffWordWrap: wordWrap }),
    // Orca's setting names the opposite: "show whitespace changes".
    ignoreWhitespace: settings?.diffShowWhitespace !== true,
    setIgnoreWhitespace: (ignore) => void updateSettings({ diffShowWhitespace: !ignore }),
    fileTreeOpen: pickedTreeOpen ?? settings?.combinedDiffFileTreeVisibleByDefault === true,
    setFileTreeOpen: (open) => {
      combinedDiffViewPreferences.fileTreeCollapsed = !open
      setPickedTreeOpen(open)
    }
  }
}
