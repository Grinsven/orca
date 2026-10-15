import { isDeepStrictEqual } from 'node:util'
import { isJoseUiVariant } from '../src/shared/fork/jose-ui-variant'
import {
  TERMINAL_COLOR_KEYS,
  normalizeTerminalCustomThemes
} from '../src/shared/terminal-custom-themes'
import { TERMINAL_THEME_CATALOG } from '../src/shared/terminal-themes'
import {
  ACTIVITY_GROUP_BY_VALUES,
  THREAD_READ_FILTER_VALUES
} from '../src/shared/agents-view-thread-filters'
import { normalizeTerminalQuickCommands } from '../src/shared/terminal-quick-commands'

export type PreferenceRecord = Record<string, unknown>
type Check = (value: unknown) => boolean
const bool: Check = (value) => typeof value === 'boolean'
const number: Check = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= -10 && value <= 1_000_000
const font: Check = (value) =>
  typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9 ,.'"_-]*$/.test(value)
const color: Check = (value) =>
  typeof value === 'string' && /^(?:#[a-f\d]{3,8}|rgba?\([\d., %]+\)|transparent)?$/i.test(value)
const choices =
  (...values: string[]): Check =>
  (value) =>
    typeof value === 'string' && values.includes(value)
const names: Check = (value) =>
  typeof value === 'string' &&
  (Object.hasOwn(TERMINAL_THEME_CATALOG, value) || /^custom:[a-z0-9:_-]+$/i.test(value))

export function record(value: unknown): PreferenceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(Object.entries(value))
}

const settingsChecks: Record<string, Check> = {
  theme: choices('system', 'dark', 'light'),
  joseUiVariant: isJoseUiVariant,
  leftSidebarAppearanceMode: choices('default', 'match-terminal', 'tinted'),
  leftSidebarTintColor: color,
  leftSidebarTintOpacity: number,
  appFontFamily: font,
  editorFontFamily: font,
  terminalFontFamily: font,
  terminalThemeDark: names,
  terminalThemeLight: names,
  terminalDividerColorDark: color,
  terminalDividerColorLight: color,
  terminalGpuAcceleration: choices('auto', 'on', 'off'),
  terminalLigatures: choices('auto', 'on', 'off'),
  terminalCursorStyle: choices('bar', 'block', 'underline'),
  modernUiTabStyle: choices('connected', 'pill'),
  modernUiDensity: choices('default', 'compact'),
  ctrlTabOrderMode: choices('mru', 'sequential'),
  terminalShortcutPolicy: choices('orca-first', 'terminal-first'),
  terminalMacOptionAsAlt: choices('auto', 'true', 'false', 'left', 'right'),
  sourceControlViewMode: choices('list', 'tree'),
  sourceControlGroupOrder: choices('changes-first', 'staged-first', 'untracked-first'),
  diffDefaultView: choices('inline', 'side-by-side')
}

for (const key of [
  'editorAutoSave',
  'editorMinimapEnabled',
  'editorWordWrap',
  'richMarkdownSpellcheckEnabled',
  'markdownReviewToolsEnabled',
  'terminalInlineImages',
  'terminalCursorBlink',
  'terminalUseSeparateLightTheme',
  'terminalMouseHideWhileTyping',
  'windowBackgroundBlur',
  'terminalRightClickToPaste',
  'terminalFocusFollowsMouse',
  'terminalClipboardOnSelect',
  'terminalCopyTrimsGutter',
  'primarySelectionMiddleClickPaste',
  'showTitlebarAppName',
  'showTasksButton',
  'showAutomationsButton',
  'showArtifactsButton',
  'showSkillsButton',
  'showMobileButton',
  'showPinnedWorktreesInGroups',
  'compactWorktreeCards',
  'experimentalNewWorktreeCardStyle',
  'modernUi',
  'modernUiFrostedGlass',
  'modernUiUppercaseHeaders',
  'diffWordWrap',
  'diffShowWhitespace',
  'diffCollapseUnchangedRegions',
  'combinedDiffFileTreeVisibleByDefault',
  'confirmClosePinnedTab',
  'editorPreviewTabsEnabled',
  'terminalCursorStyleDefaultedToBlock',
  'terminalRightClickToPasteDefaultedForPlatform',
  'terminalTuiScrollSensitivityDefaultedToOne',
  'terminalMacOptionAsAltMigrated',
  'primarySelectionMiddleClickPasteDefaultedForLinux',
  'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
]) {
  settingsChecks[key] = bool
}

for (const key of [
  'editorAutoSaveDelayMs',
  'terminalFontSize',
  'terminalFontWeight',
  'terminalFontWeightBold',
  'terminalLineHeight',
  'terminalScrollSensitivity',
  'terminalFastScrollSensitivity',
  'terminalTuiScrollSensitivity',
  'terminalInactivePaneOpacity',
  'terminalActivePaneOpacity',
  'terminalPaneOpacityTransitionMs',
  'terminalDividerThicknessPx',
  'terminalBackgroundOpacity',
  'terminalMinimumContrastRatio',
  'terminalPaddingX',
  'terminalPaddingY',
  'terminalCursorOpacity',
  'terminalScrollbackRows',
  'modernUiFrostedGlassOpacity',
  'sourceControlHistoryPanelHeight'
]) {
  settingsChecks[key] = number
}

const uiChecks: Record<string, Check> = {
  groupBy: choices('none', 'workspace-status', 'repo', 'pr-status'),
  groupBySecondary: choices('none', 'workspace-status', 'repo', 'pr-status'),
  sortBy: choices('name', 'smart', 'recent', 'repo', 'manual'),
  projectOrderBy: choices('manual', 'recent'),
  rightSidebarTab: choices(
    'explorer',
    'search',
    'vault',
    'workspaces',
    'pr-checks',
    'source-control',
    'checks',
    'ports'
  ),
  rightSidebarExplorerView: choices('files', 'search'),
  agentActivityDisplayMode: choices('compact', 'full'),
  agentsReadFilter: choices(...THREAD_READ_FILTER_VALUES),
  agentsGroupBy: choices(...ACTIVITY_GROUP_BY_VALUES),
  usagePercentageDisplay: choices('used', 'remaining'),
  statusBarUsageMode: choices('compact', 'verbose')
}
for (const key of [
  'sidebarWidth',
  'rightSidebarWidth',
  'markdownTocPanelWidth',
  'combinedDiffFileTreeWidth',
  'uiZoomLevel',
  'editorFontZoomLevel',
  'workspaceBoardOpacity',
  'workspaceBoardColumnWidth'
]) {
  uiChecks[key] = number
}
for (const key of [
  'sidebarOpen',
  'rightSidebarOpen',
  'hideSleepingWorkspaces',
  'hideDefaultBranchWorkspace',
  'hideAutomationGeneratedWorkspaces',
  'hideCliCreatedWorkspaces',
  'hideDetachedHeadWorkspaces',
  'hideWorkspacesFromOtherDevices',
  'alwaysShowDefaultBranchWorkspace',
  'agentsHideWorkspacesFromOtherDevices',
  'agentsHideAutomationGeneratedWorkspaces',
  'agentsHideCliCreatedWorkspaces',
  'agentsShowChildAgents',
  'agentsCompactMode',
  'agentsShowSearch',
  'statusBarVisible',
  '_worktreeCardModeDefaulted',
  '_expandedWorktreeCardPropertiesDefaulted',
  '_jiraIssueWorktreeCardPropertyDefaulted',
  '_hostWorktreeCardPropertyDefaulted',
  '_inlineAgentsDefaultedForAllUsers',
  '_inlineAgentsDefaultedForExperiment',
  '_portsStatusBarDefaultAdded',
  '_kimiStatusBarDefaultAdded',
  '_minimaxStatusBarDefaultAdded',
  '_antigravityStatusBarDefaultAdded',
  '_grokStatusBarDefaultAdded',
  '_cursorStatusBarDefaultAdded',
  '_zcodeStatusBarDefaultAdded',
  '_sortBySmartMigrated'
]) {
  uiChecks[key] = bool
}

const arrayOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.length <= 40 && value.every(check)
uiChecks.statusBarItems = arrayOf(
  choices(
    'claude',
    'codex',
    'gemini',
    'antigravity',
    'opencode-go',
    'kimi',
    'minimax',
    'grok',
    'cursor',
    'zcode',
    'ssh',
    'resource-usage',
    'ports'
  )
)
uiChecks.worktreeCardProperties = arrayOf(
  choices(
    'status',
    'unread',
    'ci',
    'branch',
    'issue',
    'linear-issue',
    'jira-issue',
    'pr',
    'automation',
    'cli',
    'comment',
    'ports',
    'inline-agents',
    'host'
  )
)

function select(source: unknown, checks: Record<string, Check>): PreferenceRecord {
  return Object.fromEntries(
    Object.entries(record(source)).filter(([key, value]) => checks[key]?.(value))
  )
}

/** Both persisted sections are projected positively; the window seed's omissions are not a privacy boundary. */
export function projectPreferences(source: { settings?: unknown; ui?: unknown }): {
  settings: PreferenceRecord
  ui: PreferenceRecord
} {
  const raw = record(source.settings)
  const settings = select(raw, settingsChecks)
  if (Array.isArray(raw.terminalCustomThemes)) {
    settings.terminalCustomThemes = normalizeTerminalCustomThemes(raw.terminalCustomThemes)
  }
  if (Array.isArray(raw.terminalQuickCommands)) {
    settings.terminalQuickCommands = normalizeTerminalQuickCommands(
      raw.terminalQuickCommands
    ).filter((command) => command.action !== 'agent-prompt' && command.scope?.type !== 'repo')
  }
  if (raw.terminalColorOverrides) {
    settings.terminalColorOverrides = select(
      raw.terminalColorOverrides,
      Object.fromEntries(TERMINAL_COLOR_KEYS.map((key) => [key, color]))
    )
  }
  if (raw.nativeChatAppearance) {
    settings.nativeChatAppearance = select(raw.nativeChatAppearance, {
      fontSize: number,
      codeFontSize: number,
      contrast: number,
      matchTerminalInterface: bool,
      width: choices('comfortable', 'wide', 'full')
    })
  }
  return { settings, ui: select(source.ui, uiChecks) }
}

export function assertPortablePreferences(value: { settings?: unknown; ui?: unknown }): void {
  const projected = projectPreferences(value)
  if (!isDeepStrictEqual(projected, { settings: value.settings, ui: value.ui })) {
    throw new Error('Snapshot contains unsupported or private preference fields')
  }
  const serialized = JSON.stringify(projected)
  if (
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\|https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})/i.test(
      serialized
    )
  ) {
    throw new Error('Snapshot contains a private or machine-specific preference value')
  }
}

export function mergePreferences(target: unknown, updates: unknown): PreferenceRecord {
  const merged = { ...record(target) }
  for (const [key, value] of Object.entries(record(updates))) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('Unsafe object key')
    }
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? mergePreferences(merged[key], value)
        : value
  }
  return merged
}
