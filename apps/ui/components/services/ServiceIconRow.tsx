'use client'

import { Icon } from '@/components/ui/icon'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'

const MAX_SHOWN = 6

export function ServiceIconRow({ slugs, max = MAX_SHOWN, className }: { slugs: string[]; max?: number; className?: string }) {
    const { resolved, loading } = useCatalogServices(slugs)
    if (!slugs.length) return null

    const shown = slugs.slice(0, max)
    const hidden = slugs.slice(max)
    const nameOf = (slug: string) => resolved.get(slug)?.name ?? slug

    return (
        <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
            {shown.map(slug => {
                const service = resolved.get(slug)
                if (!service && loading) return <span key={slug} className="size-5 shrink-0 animate-pulse rounded-md bg-primary/5" />
                return (
                    <TooltipLabeled key={slug} label={nameOf(slug)}>
                        <Icon {...serviceIconProps(service?.icon ?? null, service?.category)} size="xs" />
                    </TooltipLabeled>
                )
            })}
            {hidden.length > 0 && (
                <TooltipLabeled
                    contentClassName="flex-col items-start gap-1"
                    label={hidden.map(slug => (
                        <span key={slug}>{nameOf(slug)}</span>
                    ))}
                >
                    <span className="inline-flex size-5 cursor-default items-center justify-center rounded-md border border-border bg-primary/5 text-[10px] font-medium text-muted-foreground">+{hidden.length}</span>
                </TooltipLabeled>
            )}
        </div>
    )
}
