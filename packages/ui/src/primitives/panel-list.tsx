import type { ReactNode } from 'react'
import { cn } from '../cn'

export function PanelScroller({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('min-h-0 flex-1 overflow-y-auto p-3', className)}>{children}</div>
}

export function PanelList({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('space-y-2', className)}>{children}</div>
}

export function PanelGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('grid grid-cols-2 content-start gap-2', className)}>{children}</div>
}

export function PanelSection({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('space-y-2', className)}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
            {children}
        </section>
    )
}

// `countLabel` is the count already worded by the caller in the reader's language ("3 triggers");
// `count` + `noun` is the older English-only form.
type PanelListHeaderProps = { children?: ReactNode; className?: string } & (
    | { count: number; noun: string; countLabel?: never }
    | { countLabel: string; count?: never; noun?: never }
    | { count?: never; noun?: never; countLabel?: never }
)

export function PanelListHeader({ count, noun, countLabel, children, className }: PanelListHeaderProps) {
    return (
        <div className={cn('flex items-center justify-between gap-2 border-b border-border px-3 py-2', className)}>
            {countLabel !== undefined ? (
                <p className="text-xs text-muted-foreground">{countLabel}</p>
            ) : (
                count !== undefined && (
                    <p className="text-xs text-muted-foreground">
                        {count} {noun}
                        {count !== 1 ? 's' : ''}
                    </p>
                )
            )}
            {children}
        </div>
    )
}
