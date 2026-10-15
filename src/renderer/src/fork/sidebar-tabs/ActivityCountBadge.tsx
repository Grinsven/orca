import { Badge } from '@/components/ui/badge'

export function ActivityCountBadge({ count }: { count?: string | null }): React.JSX.Element | null {
  return count ? (
    <Badge variant="secondary" data-sidebar-change-count="" aria-hidden="true">
      {count}
    </Badge>
  ) : null
}
