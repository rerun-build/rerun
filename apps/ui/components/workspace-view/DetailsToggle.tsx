'use client'

import { Button } from '@/components/ui/button'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { useDetailsOpen } from '@/components/workspace-view/useDetailsOpen'
import { PanelRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'

/** At the end of the chat's bar: opens or closes the column beside it, for a coworker and the Chief of Staff alike. */
export function DetailsToggle({ label }: { label: string }) {
    const open = useDetailsOpen()
    return (
        <TooltipLabeled label={label}>
            <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={open} onClick={() => useSimpleDetailsStore.getState().setWanted(!open)} className={cn(open && 'bg-accent')}>
                <PanelRightIcon className="size-4" />
            </Button>
        </TooltipLabeled>
    )
}
