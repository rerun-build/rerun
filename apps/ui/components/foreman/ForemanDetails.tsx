'use client'

import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { renameForemanAction } from '@/app/api/_actions/foreman-name.actions'

import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import { ForemanCard } from '@/components/foreman/ForemanCard'
import { ForemanRoutines } from '@/components/foreman/ForemanRoutines'
import { Button } from '@/components/ui/button'
import { EditableName } from '@/components/ui/editable-name'
import { useErrorText } from '@/hooks/useErrorText'
import { FOREMAN_NAME_MAX } from '@/lib/foreman/name'
import { XIcon } from '@/lib/icons'
import { foremanOrbState, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { useForemanName } from '@/hooks/useForemanName'

/**
 * The Chief of Staff's column beside its chat in the Simple view, the place a coworker's card has: who
 * it is, what it keeps of its own when its engine holds any, then every routine of the workspace.
 */
export function ForemanDetails({ shown, onClose }: { shown: boolean; onClose: () => void }) {
    const t = useTranslations('workspaceView.foreman')
    const foremanName = useForemanName()
    const tCard = useTranslations('agent.agentCard')
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)
    const hasCard = useForemanStore(state => state.hasCard)
    const admin = useIsWorkspaceAdmin()
    const errorText = useErrorText()

    const rename = async (next: string) => {
        const result = await renameForemanAction(next)
        if (result.ok) useForemanStore.getState().setName(result.name)
        else toast.error(errorText(result))
    }

    const identity = (
        <>
            <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-3">
                <Button aria-label={tCard('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                    <XIcon className="size-4" />
                </Button>
            </div>
            <div className="flex shrink-0 flex-col items-center px-4 pt-4 pb-3">
                <Orb size={WELCOME_ORB_SIZE} state={foremanOrbState({ open, activity })} />
                {admin ? (
                    <div className="mt-2 flex max-w-full justify-center">
                        <EditableName name={t('name', foremanName)} onRename={next => void rename(next)} label={t('rename')} maxLength={FOREMAN_NAME_MAX} allowEmpty className="text-base leading-tight font-semibold" />
                    </div>
                ) : (
                    <span className="mt-2 max-w-full truncate text-base leading-tight font-semibold">{t('name', foremanName)}</span>
                )}
                <span className="text-xs text-muted-foreground">{t('line')}</span>
            </div>
        </>
    )
    const routines = (
        <>
            <h3 className="shrink-0 px-4 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{tCard('destinations.scheduled')}</h3>
            <ForemanRoutines docked={false} active={shown} className="min-h-0 flex-1" />
        </>
    )

    if (!hasCard) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                {identity}
                {routines}
            </div>
        )
    }
    return (
        <ForemanCard lead={identity} onClose={onClose} active={shown}>
            {routines}
        </ForemanCard>
    )
}
