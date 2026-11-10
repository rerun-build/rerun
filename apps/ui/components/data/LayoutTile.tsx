'use client'

import { LAYOUT_ICONS } from '@/lib/data/views'
import { cn } from '@/lib/utils'
import type { CardLayout } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

type LayoutTileProps = {
    layout: CardLayout
    active?: boolean
    onClick: () => void
}

export function LayoutTile({ layout, active, onClick }: LayoutTileProps) {
    const t = useTranslations('data.layouts')
    const LayoutIcon = LAYOUT_ICONS[layout]
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active ? 'border-primary/40 text-primary ring-1 ring-primary/40' : 'text-muted-foreground hover:border-foreground/20 hover:text-foreground',
            )}
        >
            <LayoutIcon className="size-5" />
            {t(layout)}
        </button>
    )
}
