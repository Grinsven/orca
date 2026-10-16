export function ActivityCountBadge({ count }: { count?: string | null }): React.JSX.Element | null {
  return count ? (
    <span data-sidebar-change-count="" aria-hidden="true">
      {count}
    </span>
  ) : null
}
