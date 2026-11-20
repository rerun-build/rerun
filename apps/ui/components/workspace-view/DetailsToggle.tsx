'use client'

import type { ReactNode } from 'react'

import { TooltipLabeled } from '@/components/ui/tooltip'
import { useDetailsOpen } from '@/components/workspace-view/useDetailsOpen'
import { cn } from '@/lib/utils'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'

/**
 * At the start of the chat's bar: the coworker's buddy, or the Chief of Staff's orb, which opens or
 * closes the card beside the chat. A plain button: the kit's shrinks every svg inside it to an icon's size.
 */
export function DetailsToggle({ label, avatar }: { label: string; avatar: ReactNode }) {
    const open = useDetailsOpen()
    return (
        <TooltipLabeled label={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={open}
                onClick={() => useSimpleDetailsStore.getState().setWanted(!open)}
                className={cn('flex size-9 shrink-0 items-center justify-center rounded-md transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50', open && 'bg-accent')}
            >
                {avatar}
            </button>
        </TooltipLabeled>
    )
}
