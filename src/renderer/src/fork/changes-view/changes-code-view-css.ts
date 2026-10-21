// Adapted from T3 Code (github.com/pingdotgg/t3code, MIT, Copyright (c) 2026 T3 Tools Inc.)
// Pierre renders each file in a shadow root; this sheet maps its variables onto Orca's tokens.
// Every color comes from main.css (editor surface, foreground, diff and git decoration tokens).
export const CHANGES_CODE_VIEW_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --code-background: var(--editor-surface);
  --code-foreground: var(--foreground);
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--changes-code-font, var(--font-mono)) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-addition-base: var(--git-decoration-added);
  --diffs-deletion-base: var(--git-decoration-deleted);
  --diffs-modified-base: var(--git-decoration-modified);

  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--code-background) 95%, var(--code-foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));

  --diffs-bg-addition-override: var(--diff-added-ground);
  --diffs-bg-addition-number-override: var(--diff-added-gutter);
  --diffs-bg-addition-hover-override: var(--diff-added-gutter);
  --diffs-bg-addition-emphasis-override: var(--diff-added-gutter);
  --diffs-bg-deletion-override: var(--diff-removed-ground);
  --diffs-bg-deletion-number-override: var(--diff-removed-gutter);
  --diffs-bg-deletion-hover-override: var(--diff-removed-gutter);
  --diffs-bg-deletion-emphasis-override: var(--diff-removed-gutter);

  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}

/* A 1fr track grows with the mounted lines; in split wrap mode that rewraps rows and makes the
   virtualizer keep correcting the scroll position. Keep both code columns the same width. */
[data-diff-type="split"][data-overflow="wrap"] {
  --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
}

[data-file-info] {
  background-color: var(--code-background) !important;
  border-block-color: transparent !important;
  color: var(--code-foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--code-background) !important;
  border-bottom: 1px solid var(--border) !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  /* Collapsed items are never remeasured: the painted header must match diffHeaderHeight. */
  height: 32px !important;
  min-height: 32px !important;
  box-sizing: border-box !important;
  padding-block: 0 !important;
  padding-inline: 8px 12px !important;
}

[data-diffs-header]:hover {
  box-shadow: inset 3px 0 color-mix(in srgb, var(--code-foreground) 24%, transparent);
}

/* The "N unmodified lines" bands: one quiet step off the code surface, brighter on hover. */
:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  /* Exact and margin-free: the virtualizer places rows from hunkSeparatorHeight. */
  height: 24px !important;
  margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) :is([data-separator-content], [data-expand-button]) {
  color: var(--muted-foreground) !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
  text-decoration: none !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  :is([data-separator-content], [data-expand-button]):hover {
  color: var(--code-foreground) !important;
  background-color: color-mix(in srgb, var(--code-background) 92%, var(--code-foreground)) !important;
}

[data-diffs-header] [data-header-content],
[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

/* Pierre clips names for its start ellipsis; a 1em line box cuts off descenders. */
[data-diffs-header] :is([data-title], [data-prev-name]) {
  line-height: 16px !important;
}

/* Orca renders its own counts, which also cover files whose body is not loaded. */
[data-diffs-header] :is([data-additions-count], [data-deletions-count]) {
  display: none !important;
}

[data-diffs-header] :is([data-change-icon], [data-rename-icon]) {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  text-decoration: underline;
}
`
