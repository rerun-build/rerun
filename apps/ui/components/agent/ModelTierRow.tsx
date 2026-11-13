import { PowerBars } from '@/components/ui/power-bars'
import type { ReactNode } from 'react'

type ModelTierRowProps = {
    label: string
    description?: string
    power?: number
    trailing?: ReactNode
}

// The inside of a Rerun tier's row, shared by every model picker. The container (a CommandItem, a
// SelectItem) stays the picker's own, and so does the check that marks the current pick.
export function ModelTierRow({ label, description, power, trailing }: ModelTierRowProps) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className={description ? 'shrink-0' : 'min-w-0 flex-1 truncate text-left'}>{label}</span>
            {description && <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">{description}</span>}
            {trailing}
            <PowerBars power={power} className="shrink-0" />
        </span>
    )
}
