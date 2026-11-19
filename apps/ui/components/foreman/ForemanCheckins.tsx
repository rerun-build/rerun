'use client'

import { FOREMAN_AGENT_ID, type CheckinEntry, type ForemanCheckins as Checkins, type Proactive } from '@rerun/contracts'
import { shortRelativeTime, shortUntil } from '@rerun/i18n/format'
import { Skeleton } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { loadForemanCheckinsAction, runForemanCheckinAction, updateForemanCheckinsAction } from '@/app/api/_actions/foreman-checkins.actions'
import { RunModelField } from '@/components/agent/RunModelField'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import type { ConnectionGroup } from '@/lib/engine/model-groups'
import { useErrorText } from '@/hooks/useErrorText'
import { cn } from '@/lib/utils'

const SHOWN_CHECKINS = 5

function CheckinRow({ checkin, locale }: { checkin: CheckinEntry; locale: string }) {
    const t = useTranslations('workspaceView.checkins')
    const spoke = !!checkin.announcedAt
    return (
        <li className="flex min-w-0 items-baseline gap-2 py-1.5 text-sm">
            <span className={cn('size-1.5 shrink-0 -translate-y-0.5 rounded-full', spoke ? 'bg-brand' : 'bg-muted-foreground/40')} aria-hidden />
            <span className={cn('min-w-0 flex-1 truncate', !spoke && 'text-muted-foreground')}>{spoke ? checkin.title : checkin.status === 'error' ? t('failed') : t(`reasons.${checkin.reason}`)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{shortRelativeTime(checkin.startedAt, locale)}</span>
        </li>
    )
}

export function ForemanCheckinsSkeleton() {
    return (
        <section className="shrink-0 space-y-2 px-4 pb-3" aria-busy>
            <div className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            <Skeleton className="h-8 w-full rounded-md" />
        </section>
    )
}

type ForemanCheckinsViewProps = {
    checkins: Checkins
    availableGroups: ConnectionGroup[]
    agentModel: string | null
    running: boolean
    onSave: (proactive: Proactive) => void
    onRunNow: () => void
    now?: Date
}

/** The switch, the model its check-ins run on, a button to check in now, and the last few it made. */
export function ForemanCheckinsView({ checkins, availableGroups, agentModel, running, onSave, onRunNow, now }: ForemanCheckinsViewProps) {
    const t = useTranslations('workspaceView.checkins')
    const locale = useLocale()
    const { proactive, available } = checkins
    const on = available && proactive.enabled
    const status = !available ? t('unavailable') : !proactive.enabled ? t('off') : checkins.nextAt ? t('next', { when: shortUntil(checkins.nextAt, locale, now) }) : t('waiting')

    return (
        <section className="shrink-0 space-y-3 px-4 pb-3" aria-label={t('title')}>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('title')}</h3>
                    <p className="truncate text-xs text-muted-foreground">{status}</p>
                </div>
                <TooltipDisabledReason reason={available ? undefined : t('unavailable')}>
                    <Switch aria-label={t('toggle')} checked={on} disabled={!available} onCheckedChange={enabled => onSave({ ...proactive, enabled })} />
                </TooltipDisabledReason>
            </div>
            {on && <RunModelField id="checkin-model" value={{ connectionId: proactive.connectionId, model: proactive.model }} onChange={pick => onSave({ ...proactive, connectionId: pick.connectionId, model: pick.model })} availableGroups={availableGroups} agentModel={agentModel} helperText={t('modelHelper')} />}
            <TooltipDisabledReason reason={on ? undefined : t('switchedOff')}>
                <Button variant="outline" size="sm" className="w-full" disabled={!on || running} onClick={onRunNow}>
                    {t('runNow')}
                </Button>
            </TooltipDisabledReason>
            {checkins.checkins.length > 0 ? (
                <ul className="divide-y divide-border/60">
                    {checkins.checkins.slice(0, SHOWN_CHECKINS).map(checkin => (
                        <CheckinRow key={checkin.runId} checkin={checkin} locale={locale} />
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-muted-foreground">{t('empty')}</p>
            )}
        </section>
    )
}

/**
 * The Chief of Staff waking on its own, on its card, for an admin. Absent on a box that has no
 * check-ins yet, read again each time the card shows.
 */
export function ForemanCheckins({ active }: { active: boolean }) {
    const t = useTranslations('workspaceView.checkins')
    const errorText = useErrorText()
    const [checkins, setCheckins] = useState<Checkins | null | undefined>(undefined)
    const [running, setRunning] = useState(false)
    const { availableGroups, resolvedModel } = useAvailableModels(FOREMAN_AGENT_ID)

    const reload = useCallback(() => {
        void loadForemanCheckinsAction().then(setCheckins)
    }, [])

    useEffect(() => {
        if (active) reload()
    }, [active, reload])

    if (checkins === null) return null
    if (checkins === undefined) return <ForemanCheckinsSkeleton />

    const save = async (proactive: Proactive) => {
        setCheckins({ ...checkins, proactive })
        const result = await updateForemanCheckinsAction(proactive)
        if (!result.ok) toast.error(errorText(result))
        reload()
    }
    const runNow = async () => {
        setRunning(true)
        const result = await runForemanCheckinAction()
        setRunning(false)
        if (!result.ok) return void toast.error(errorText(result))
        toast.success(t('started'))
        reload()
    }

    return <ForemanCheckinsView checkins={checkins} availableGroups={availableGroups} agentModel={resolvedModel} running={running} onSave={proactive => void save(proactive)} onRunNow={() => void runNow()} />
}
