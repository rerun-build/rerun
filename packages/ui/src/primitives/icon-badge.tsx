import { Spinner } from './spinner'
import { cn } from '../cn'
import { BorderBeam } from '../BorderBeam'
import type { LucideIcon } from '../icons'

type IconBadgeProps = {
    tone?: 'brand' | 'white' | 'neutral' | 'green' | 'red'
    icon?: LucideIcon
    animated?: boolean
    glow?: boolean
    className?: string
}

export function IconBadge({ tone = 'brand', icon: Icon, animated = false, glow = true, className }: IconBadgeProps) {
    return (
        <span className={cn('relative flex size-5 shrink-0 items-center justify-center rounded-full', className)}>
            <BorderBeam pattern="ring" tone={tone} glow={glow} animated={animated} />
            {Icon ? (
                <Icon className="size-3 text-foreground" />
            ) : animated ? (
                <Spinner className="size-2.5 text-foreground" />
            ) : null}
        </span>
    )
}
