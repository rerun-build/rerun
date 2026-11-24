'use client'

import { cn } from '../cn'
import { SegmentedControl, SegmentedControlItem } from '../primitives/segmented-control'
import { ThemeToggle } from '../theme/ThemeToggle'
import { KIT_BACKDROPS, KIT_SCALES, useKitControls, type KitBackdrop } from './KitControls'

export function KitToolbar({ className }: { className?: string }) {
    const { backdrop, setBackdrop, scale, setScale } = useKitControls()

    return (
        <div className={cn('sticky top-4 z-30 flex flex-wrap items-center gap-3 rounded-full border border-border bg-background/70 p-1 pe-3 backdrop-blur-md', className)}>
            <ThemeToggle />
            <SegmentedControl value={backdrop} onValueChange={value => setBackdrop(value as KitBackdrop)} className="gap-0.5 p-0.5" role="radiogroup" aria-label="Backdrop">
                {KIT_BACKDROPS.map(option => (
                    <SegmentedControlItem key={option.value} value={option.value} className="px-3 py-1 text-xs">
                        {option.label}
                    </SegmentedControlItem>
                ))}
            </SegmentedControl>
            <SegmentedControl value={String(scale)} onValueChange={value => setScale(Number(value))} className="gap-0.5 p-0.5" role="radiogroup" aria-label="Zoom">
                {KIT_SCALES.map(value => (
                    <SegmentedControlItem key={value} value={String(value)} className="px-2 py-1 font-mono text-xs">
                        {value}x
                    </SegmentedControlItem>
                ))}
            </SegmentedControl>
        </div>
    )
}
