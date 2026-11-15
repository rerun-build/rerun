import type { LibraryCreator } from '@/lib/templates/library'
import { cn } from '@/lib/utils'

export function TemplateCreatorAvatar({ creator, size, className }: { creator: LibraryCreator | null; size: number; className?: string }) {
    const style = { width: size, height: size }
    if (!creator) {
        return (
            <span className={cn('inline-flex shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-border', className)} style={style}>
                <img src="/icon-192.png" alt="" className="size-full object-cover" />
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
