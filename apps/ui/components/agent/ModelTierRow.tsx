import { PowerBars } from '@/components/ui/power-bars'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

type ModelTierRowProps = {
    label: string
    description?: string
    power?: number
    // Not included in the workspace's plan: the badge replaces whatever the row would trail with.
    locked?: boolean
    trailing?: ReactNode
}

// The inside of a Rerun tier's row, and of any row the plan locks, shared by every model picker. The
// container (a CommandItem, a SelectItem) stays the picker's own, and so does the check that marks
// the current pick.
export function ModelTierRow({ label, description, power, locked, trailing }: ModelTierRowProps) {
    const t = useTranslations('agent.modelTierRow')
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className={description ? 'shrink-0' : 'min-w-0 flex-1 truncate text-left'}>{label}</span>
            {description && <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">{description}</span>}
            {locked ? (
                <Badge size="xs" glow={false} className="shrink-0 tracking-wide uppercase">
                    {t('pro')}
                </Badge>
            ) : (
                trailing
            )}
            <PowerBars power={power} className="shrink-0" />
        </span>
    )
}
