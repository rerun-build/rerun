'use client'

import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'

import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import { ForemanRoutines } from '@/components/foreman/ForemanRoutines'
import { Button } from '@/components/ui/button'
import { XIcon } from '@/lib/icons'
import { foremanOrbState, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'

/**
 * The Chief of Staff's column beside its chat in the Simple view, the place a coworker's card has: who
 * it is, then every routine of the workspace.
 */
export function ForemanDetails({ shown, onClose }: { shown: boolean; onClose: () => void }) {
    const t = useTranslations('workspaceView.foreman')
    const tCard = useTranslations('agent.agentCard')
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-3">
                <Button aria-label={tCard('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                    <XIcon className="size-4" />
                </Button>
            </div>
            <div className="flex shrink-0 flex-col items-center px-4 pt-4 pb-3">
                <Orb size={WELCOME_ORB_SIZE} state={foremanOrbState({ open, activity })} />
                <span className="mt-2 max-w-full truncate text-base leading-tight font-semibold">{t('name')}</span>
                <span className="text-xs text-muted-foreground">{t('line')}</span>
            </div>
            <h3 className="shrink-0 px-4 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{tCard('destinations.scheduled')}</h3>
            <ForemanRoutines docked={false} active={shown} className="min-h-0 flex-1" />
        </div>
    )
}
