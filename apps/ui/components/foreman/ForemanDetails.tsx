'use client'

import { useTranslations } from 'next-intl'

import { ForemanCard, ForemanIdentity } from '@/components/foreman/ForemanCard'
import { ForemanRoutines } from '@/components/foreman/ForemanRoutines'
import { Button } from '@/components/ui/button'
import { XIcon } from '@/lib/icons'
import { useForemanStore } from '@/stores/foreman.store'

/**
 * The Chief of Staff's column beside its chat in the Simple view, the place a coworker's card has: its
 * card when its engine holds anything of its own, then every routine of the workspace.
 */
export function ForemanDetails({ shown, onClose }: { shown: boolean; onClose: () => void }) {
    const tCard = useTranslations('agent.agentCard')
    const hasCard = useForemanStore(state => state.hasCard)

    const routines = (
        <>
            <h3 className="shrink-0 px-4 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{tCard('destinations.scheduled')}</h3>
            <ForemanRoutines docked={false} active={shown} className="min-h-0 flex-1" />
        </>
    )

    if (!hasCard) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-3">
                    <Button aria-label={tCard('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                        <XIcon className="size-4" />
                    </Button>
                </div>
                <ForemanIdentity />
                {routines}
            </div>
        )
    }
    return (
        <ForemanCard onClose={onClose} active={shown}>
            {routines}
        </ForemanCard>
    )
}
