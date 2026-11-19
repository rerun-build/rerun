'use client'

import { DatabaseIcon } from '@/lib/icons'
import { faviconUrl } from '@/lib/onboarding/site-favicon'
import { cn } from '@/lib/utils'
import type { PaidSource } from '@moldwright/contracts'

const SIZE = { xs: 'size-3.5', sm: 'size-4', md: 'size-5' } as const

export type SourceLogoSize = keyof typeof SIZE

type SourceLogoProps = { source: Pick<PaidSource, 'name' | 'domain'>; size?: SourceLogoSize; className?: string }

export function SourceLogo({ source, size = 'sm', className }: SourceLogoProps) {
    if (!source.domain) {
        return (
            <span role="img" aria-label={source.name} className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] bg-muted text-muted-foreground', SIZE[size], className)}>
                <DatabaseIcon className="size-[70%]" />
            </span>
        )
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={faviconUrl(source.domain)} alt={source.name} className={cn('shrink-0 rounded-[4px] bg-white ring-1 ring-border', SIZE[size], className)} />
}

type SourceFacepileProps = { sources: readonly Pick<PaidSource, 'id' | 'name' | 'domain'>[]; size?: SourceLogoSize; max?: number; className?: string }

export function SourceFacepile({ sources, size = 'sm', max = 3, className }: SourceFacepileProps) {
    const shown = sources.slice(0, max)
    const hidden = sources.length - shown.length
    return (
        <span className={cn('flex items-center', className)}>
            <span className="flex items-center -space-x-1">
                {shown.map(source => (
                    <SourceLogo key={source.id} source={source} size={size} className="ring-2 ring-background" />
                ))}
            </span>
            {hidden > 0 && <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">+{hidden}</span>}
        </span>
    )
}
