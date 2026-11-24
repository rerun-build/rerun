'use client'

import type { CheckinEntry, ForemanCheckins as Checkins } from '@rerun/contracts'
import { shortRelativeTime, shortUntil } from '@rerun/i18n/format'
import { Skeleton } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { loadForemanCheckinsAction, runForemanCheckinAction, updateForemanCheckinsAction } from '@/app/api/_actions/foreman-checkins.actions'
import { CardRowButton } from '@/components/agent/sheet/AgentCard'
import { AgentViewHeader } from '@/components/agent/sheet/AgentView'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { Play, Sunrise } from '@/lib/icons'
import { cn } from '@/lib/utils'

type CheckinsControls = {
    checkins: Checkins | null | undefined
    running: boolean
    setEnabled: (enabled: boolean) => void
    runNow: () => void
}

const UNDER_WAY_POLL_MS = 5_000

// What the card reads of its check-ins: undefined while loading, null on a box that has none. They
// run on the model picked in its composer, so nothing is pinned here.
function useForemanCheckins(active: boolean): CheckinsControls {
    const t = useTranslations('workspaceView.checkins')
    const errorText = useErrorText()
    const [checkins, setCheckins] = useState<Checkins | null | undefined>(undefined)
    const [running, setRunning] = useState(false)

    // A reload that fails keeps what is on screen: only a first load says there is nothing to show.
    const reload = useCallback(() => {
        void loadForemanCheckinsAction().then(next => setCheckins(current => next ?? current ?? null))
    }, [])

    useEffect(() => {
        if (active) reload()
    }, [active, reload])

    const underWay = active && !!checkins?.checkins.some(checkin => checkin.status === 'running')
    useEffect(() => {
        if (!underWay) return
        const timer = setInterval(reload, UNDER_WAY_POLL_MS)
        return () => clearInterval(timer)
    }, [underWay, reload])

    const setEnabled = async (enabled: boolean) => {
        if (!checkins) return
        const proactive = { enabled, connectionId: null, model: null }
        setCheckins({ ...checkins, proactive })
        const result = await updateForemanCheckinsAction(proactive)
        if (!result.ok) {
            toast.error(errorText(result))
            setCheckins(checkins)
        }
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

    return { checkins, running, setEnabled: enabled => void setEnabled(enabled), runNow: () => void runNow() }
}

function useCheckinsStatus(checkins: Checkins, now?: Date): string {
    const t = useTranslations('workspaceView.checkins')
    const locale = useLocale()
    if (!checkins.available) return t('unavailable')
    if (!checkins.proactive.enabled) return t('off')
    return checkins.nextAt ? t('next', { when: shortUntil(checkins.nextAt, locale, now) }) : t('waiting')
}

/** The row of the card that opens its check-ins, with where they stand. Absent on a box without them. */
export function ForemanCheckinsRow({ active, onOpen }: { active: boolean; onOpen: () => void }) {
    const { checkins } = useForemanCheckins(active)
    if (checkins === null) return null
    if (checkins === undefined) return <Skeleton className="h-10 w-full rounded-lg" />
    return <ForemanCheckinsRowView checkins={checkins} onOpen={onOpen} />
}

export function ForemanCheckinsRowView({ checkins, onOpen, now }: { checkins: Checkins; onOpen: () => void; now?: Date }) {
    const t = useTranslations('workspaceView.checkins')
    return <CardRowButton icon={Sunrise} label={t('title')} detail={useCheckinsStatus(checkins, now)} onClick={onOpen} />
}

/** The screen of the card its row opens: the switch, a discreet way to check in now, and what it did. */
export function ForemanCheckinsScreen({ name, avatar, onBack, onClose }: { name: string; avatar: ReactNode; onBack: () => void; onClose: () => void }) {
    const t = useTranslations('workspaceView.checkins')
    const { checkins, running, setEnabled, runNow } = useForemanCheckins(true)
    // Nothing to show on this box, or none to reach: back to the card, where the row is gone too.
    useEffect(() => {
        if (checkins === null) onBack()
    }, [checkins, onBack])
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AgentViewHeader name={name} avatar={avatar} title={t('title')} onBack={onBack} onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto">{checkins ? <ForemanCheckinsView checkins={checkins} running={running} onEnabledChange={setEnabled} onRunNow={runNow} /> : <ForemanCheckinsSkeleton />}</div>
        </div>
    )
}

export function ForemanCheckinsSkeleton() {
    return (
        <div className="space-y-5 p-4" aria-busy>
            <div className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            <div className="space-y-4">
                {[0, 1, 2].map(index => (
                    <div key={index} className="flex items-center gap-3">
                        <Skeleton className="size-2.5 rounded-full" />
                        <Skeleton className="h-3 flex-1" />
                        <Skeleton className="h-3 w-6" />
                    </div>
                ))}
            </div>
        </div>
    )
}

type ForemanCheckinsViewProps = {
    checkins: Checkins
    running: boolean
    onEnabledChange: (enabled: boolean) => void
    onRunNow: () => void
    now?: Date
}

export function ForemanCheckinsView({ checkins, running, onEnabledChange, onRunNow, now }: ForemanCheckinsViewProps) {
    const t = useTranslations('workspaceView.checkins')
    const status = useCheckinsStatus(checkins, now)
    const on = checkins.available && checkins.proactive.enabled

    return (
        <div className="space-y-5 p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-medium">{t('toggle')}</p>
                    <p className="truncate text-xs text-muted-foreground">{status}</p>
                </div>
                <TooltipDisabledReason reason={checkins.available ? undefined : t('unavailable')}>
                    <Switch aria-label={t('toggle')} checked={on} disabled={!checkins.available} onCheckedChange={onEnabledChange} />
                </TooltipDisabledReason>
            </div>
            <section className="space-y-3" aria-label={t('recent')}>
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('recent')}</h3>
                    <TooltipDisabledReason reason={on ? undefined : t('switchedOff')}>
                        <Button variant="ghost" size="sm" className="-me-2 h-7 gap-1.5 px-2 text-xs text-muted-foreground" disabled={!on || running} onClick={onRunNow}>
                            <Play className="size-3" />
                            {t('runNow')}
                        </Button>
                    </TooltipDisabledReason>
                </div>
                {checkins.checkins.length > 0 ? <CheckinTimeline checkins={checkins.checkins} now={now} /> : <p className="text-xs text-muted-foreground">{t('empty')}</p>}
            </section>
        </div>
    )
}

function CheckinTimeline({ checkins, now }: { checkins: CheckinEntry[]; now?: Date }) {
    const t = useTranslations('workspaceView.checkins')
    const locale = useLocale()
    return (
        <ol>
            {checkins.map((checkin, index) => {
                const spoke = !!checkin.announcedAt
                const underWay = checkin.status === 'running'
                const failed = !spoke && checkin.status === 'error'
                const quiet = underWay ? t('running') : failed ? t('failed') : checkin.status === 'cancelled' ? t('stopped') : t(`reasons.${checkin.reason}`)
                return (
                    <li key={checkin.runId} className="relative flex gap-3 pb-4 last:pb-0">
                        {index < checkins.length - 1 && <span aria-hidden className="absolute top-4 bottom-0 start-[4.5px] w-px bg-border" />}
                        <span aria-hidden className="flex h-5 w-2.5 shrink-0 items-center justify-center">
                            <span className={cn('rounded-full', spoke ? 'size-2.5 bg-brand ring-4 ring-brand/15' : underWay ? 'size-2 bg-brand motion-safe:animate-pulse' : failed ? 'size-2 bg-destructive' : 'size-2 border border-muted-foreground/50 bg-background')} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className={cn('min-w-0 flex-1 truncate text-sm leading-5', !spoke && 'text-muted-foreground')}>{spoke ? checkin.title : quiet}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{shortRelativeTime(checkin.startedAt, locale, now)}</span>
                            </div>
                            {spoke && checkin.note && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{checkin.note}</p>}
                        </div>
                    </li>
                )
            })}
        </ol>
    )
}
