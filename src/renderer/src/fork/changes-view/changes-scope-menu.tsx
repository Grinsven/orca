import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ChangesScope } from './changes-file-entries'

const SCOPE_LABELS: Record<ChangesScope, string> = {
  branch: 'Changes',
  uncommitted: 'Uncommitted'
}

function isChangesScope(value: string): value is ChangesScope {
  return value === 'branch' || value === 'uncommitted'
}

export function ChangesScopeMenu({
  scope,
  baseRef,
  onScopeChange
}: {
  scope: ChangesScope
  /** Null when the branch has no compare target, which disables the Changes scope. */
  baseRef: string | null
  onScopeChange: (scope: ChangesScope) => void
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          aria-label={`Diff scope: ${SCOPE_LABELS[scope]}`}
          data-changes-scope-trigger=""
        >
          <span className="truncate">{SCOPE_LABELS[scope]}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Compare</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope}
          onValueChange={(value) => {
            if (isChangesScope(value)) {
              onScopeChange(value)
            }
          }}
        >
          <DropdownMenuRadioItem value="branch" disabled={baseRef === null}>
            <span className="flex min-w-0 flex-col">
              <span>Changes</span>
              <span className="truncate text-xs text-muted-foreground">
                {baseRef === null ? 'No base branch to compare' : `Working tree vs ${baseRef}`}
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="uncommitted">
            <span className="flex min-w-0 flex-col">
              <span>Uncommitted</span>
              <span className="text-xs text-muted-foreground">Working tree vs HEAD</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
