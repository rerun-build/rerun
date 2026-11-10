'use client'

import { cn } from '../cn'
import { TooltipLabeled } from '../Tooltip'
import { availabilityDot } from './options'
import { useKitTranslations } from '../locale'
import type { Expert } from './types'

// A client component so the dot is created on the client side of the boundary. Rendered from a
// server component, a large RSC payload can hand the tooltip trigger its child as a lazy chunk, and
// Radix Slot renders a lazy child as nothing on the server: the dot vanished and hydration failed.
export function ExpertAvailability({ availability, className }: { availability: Expert['availability']; className?: string }) {
    const t = useKitTranslations()
    return (
        <TooltipLabeled label={t('experts.availability.tooltip', { label: t(`experts.availability.${availability}.label`), hint: t(`experts.availability.${availability}.hint`) })}>
            <span className={cn('inline-block size-2 shrink-0 rounded-full', availabilityDot(availability), className)} />
        </TooltipLabeled>
    )
}
