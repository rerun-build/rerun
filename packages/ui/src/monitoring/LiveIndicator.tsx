'use client'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'

// `animated={false}` is for the OG capture: a ping halo caught mid-cycle makes two screenshots of the
// same card differ. Frozen, it renders at its base scale, which is the frame the animation starts on.
export function LiveIndicator({ className, animated = true }: { className?: string; animated?: boolean }) {
    const t = useKitTranslations()
    return (
        <span className={cn('flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground', className)}>
            <span className="relative flex size-2">
                <span className={cn('absolute inline-flex size-full rounded-full bg-red-500 opacity-75', animated && 'animate-ping')} />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            {t('monitoring.live')}
        </span>
    )
}
