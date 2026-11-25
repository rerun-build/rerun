'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { appIconUrl } from '@/lib/brand/icons'
import type { LibraryCreator } from '@/lib/templates/library'
import { cn } from '@/lib/utils'

// A null creator is the team behind the app, drawn with the app's own icon rather than initials: the
// brand's under an organization, which the tile names beside it.
export function TemplateCreatorAvatar({ creator, size, className }: { creator: LibraryCreator | null; size: number; className?: string }) {
    const brand = useBrand()
    const style = { width: size, height: size }
    if (!creator) {
        return (
            <span className={cn('inline-flex shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-border', className)} style={style}>
                <img src={appIconUrl(brand)} alt="" className="size-full object-cover" />
            </span>
        )
    }
    if (creator.avatarUrl) {
        return <img src={creator.avatarUrl} alt="" loading="lazy" className={cn('shrink-0 rounded-full object-cover ring-1 ring-border', className)} style={style} />
    }
    return (
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-1 ring-border', className)} style={{ ...style, fontSize: size * 0.38 }}>
            {initials(creator.name)}
        </span>
    )
}

function initials(name: string) {
    return name
        .split(/\s+/)
        .map(part => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
}
