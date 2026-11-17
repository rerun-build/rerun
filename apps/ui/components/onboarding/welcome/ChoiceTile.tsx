'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@rerun/ui/primitives'
import type { ComponentType } from 'react'

export function ChoiceTile({ icon, label, selected, onClick }: { icon: ComponentType<{ className?: string }>; label: string; selected: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            data-selected={selected}
            onClick={onClick}
            className={cn(
                'flex min-h-20 flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground',
                PANEL_CARD,
                PANEL_CARD_INTERACTIVE,
                'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none data-[selected=true]:border-foreground/40 data-[selected=true]:bg-accent data-[selected=true]:text-foreground'
            )}
        >
            <Icon size="sm" icon={icon} />
            <span className="leading-tight text-balance">{label}</span>
        </button>
    )
}
