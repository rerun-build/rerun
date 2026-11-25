import { CardAvatar } from '@rerun/ui/chat'
import { WorkspaceLogoImage } from '@rerun/ui/chrome'

import { cn } from '@/lib/utils'

// The kit's tints are hard to read at this size on a dark page.
export const INITIALS = 'bg-muted text-muted-foreground'

// The logo of a workspace or of the organization, or its initials until it has one.
export function SquareLogo({ name, iconUrl, className }: { name: string; iconUrl: string | null; className?: string }) {
    const shape = cn('size-9 shrink-0 rounded-lg', className)
    if (!iconUrl) return <CardAvatar name={name} className={cn(shape, INITIALS)} />
    return <WorkspaceLogoImage src={iconUrl} className={cn(shape, 'object-cover')} />
}
