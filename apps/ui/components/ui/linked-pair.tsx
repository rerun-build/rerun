import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const DOTS = 6
const STEP_SECONDS = 0.14

// Two tiles joined by two dotted paths, each lit one dot after the other: one carries what the left
// side sends in, the other what the right side sends back.
export function LinkedPair({ left, right, label, className }: { left: ReactNode; right: ReactNode; label: string; className?: string }) {
    return (
        <div role="img" aria-label={label} className={cn('flex items-center justify-center gap-2.5', className)}>
            {left}
            <div className="flex w-16 flex-col gap-2.5">
                <DotPath direction="forward" />
                <DotPath direction="backward" />
            </div>
            {right}
        </div>
    )
}

function DotPath({ direction }: { direction: 'forward' | 'backward' }) {
    return (
        <div className="flex items-center justify-between">
            {Array.from({ length: DOTS }, (_, index) => {
                const step = direction === 'forward' ? index : DOTS - 1 - index
                const style = { animationDelay: `${step * STEP_SECONDS}s`, animationDuration: `${DOTS * STEP_SECONDS * 1.6}s` } as CSSProperties
                return <span key={index} style={style} className="size-1 rounded-full bg-muted-foreground/25 animate-link-dot motion-reduce:animate-none" />
            })}
        </div>
    )
}
