import type { ReactNode } from 'react'

import { Icon } from '@/components/ui/icon'
import type { LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export function ForemanOutcomeRow({ icon, tone, text, action, className }: { icon: LucideIcon; tone?: string; text: string; action?: ReactNode; className?: string }) {
    return (
        <div className={cn('flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm', className)}>
            <Icon icon={icon} className={tone ?? 'text-muted-foreground'} />
            <span>{text}</span>
            {action ? <div className="ms-auto shrink-0">{action}</div> : null}
        </div>
    )
}
