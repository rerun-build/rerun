'use client'

import { Orb, shortCountdown, WELCOME_ORB_SIZE } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'

import { PanelRow } from '@/components/ui/panel-row'
import { Skeleton, SkeletonPanelRows } from '@/components/ui/skeleton'
import { BookOpenIcon, CalendarClockIcon, LayersIcon, WandSparklesIcon, type LucideIcon } from '@/lib/icons'
import type { TeamEmptyStateAction, TeamEmptyStateModel, TeamEmptyStateRow, TeamPulse } from '@/lib/foreman/team-empty-state'
import { cn } from '@/lib/utils'

// The float window bottoms out at 360×420: in a column that short, the orb, the subtitle, the pulse
// and the row descriptions go before anything you can press. Measured on the size container the
// scroller of the conversation sets, padding of the stack included.
const SHORT_HIDDEN = '[@container(max-height:460px)]:hidden'
const SHORT_ROW = '[@container(max-height:460px)]:py-1.5'
const SHORT_STACK = '[@container(max-height:460px)]:gap-2 [@container(max-height:460px)]:p-0'

const PULSE_BUDDIES = 6

const ROW_ICONS: Record<Exclude<TeamEmptyStateRow['leading'], 'agent'>, LucideIcon> = {
    build: WandSparklesIcon,
    template: LayersIcon,
    guide: BookOpenIcon,
}

type ForemanTeamEmptyStateProps = {
    model: TeamEmptyStateModel
    now: number
    onSend?: (text: string) => void
    onPrefill?: (text: string) => void
    className?: string
}

export function ForemanTeamEmptyState({ model, now, onSend, onPrefill, className }: ForemanTeamEmptyStateProps) {
    const run = (action: TeamEmptyStateAction) => (action.type === 'send' ? onSend : onPrefill)?.(action.text)

    return (
        <div className={cn('my-auto flex flex-col items-center gap-4 p-4 text-center', SHORT_STACK, className)}>
            <div className={SHORT_HIDDEN}>
                <Orb size={WELCOME_ORB_SIZE} />
            </div>
            <div className="space-y-1">
                <h3 className="text-sm font-medium text-balance text-foreground">{model.title}</h3>
                {model.subtitle && <p className={cn('text-sm text-balance text-muted-foreground', SHORT_HIDDEN)}>{model.subtitle}</p>}
            </div>
            {model.pulse && <Pulse pulse={model.pulse} now={now} />}
            <div className="flex w-full max-w-sm flex-col gap-2 text-left">
                {model.rows.map(row => (
                    <PanelRow key={row.id} onClick={() => run(row.action)} leading={<RowLeading row={row} />} title={row.title} description={<span className={SHORT_HIDDEN}>{row.description}</span>} className={cn('py-2.5', SHORT_ROW)} />
                ))}
            </div>
        </div>
    )
}

function RowLeading({ row }: { row: TeamEmptyStateRow }) {
    if (row.leading === 'agent') return <AgentBuddy agentId={row.agentId} mood={row.working ? 'working' : 'idle'} size={32} animated={false} facing="right" className="shrink-0" />
    const Icon = ROW_ICONS[row.leading]
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
        </span>
    )
}

function Pulse({ pulse, now }: { pulse: TeamPulse; now: number }) {
    const t = useTranslations('foreman.teamPulse')
    const count = pulse.agents.length
    return (
        <div className={cn('flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground', SHORT_HIDDEN)}>
            <span className="flex -space-x-1.5">
                {pulse.agents.slice(0, PULSE_BUDDIES).map(agent => (
                    <AgentBuddy key={agent.id} agentId={agent.id} mood={agent.working ? 'working' : 'idle'} size={22} animated={false} facing="right" />
                ))}
            </span>
            <span>
                {t('coworkers', { count })}
                {pulse.working > 0 && (
                    <>
                        {' · '}
                        <span className="text-emerald-500">{t('working', { count: pulse.working })}</span>
                    </>
                )}
            </span>
            {pulse.nextRoutine && (
                <span className="flex min-w-0 items-center gap-1">
                    <CalendarClockIcon className="size-3 shrink-0" />
                    <span className="truncate">
                        {pulse.nextRoutine.name} {shortCountdown(new Date(pulse.nextRoutine.at).toISOString(), now)}
                    </span>
                </span>
            )}
        </div>
    )
}

export function ForemanTeamEmptyStateSkeleton() {
    return (
        <div aria-hidden className="my-auto flex flex-col items-center gap-4 p-4">
            <Skeleton className={cn('rounded-full', SHORT_HIDDEN)} style={{ width: WELCOME_ORB_SIZE, height: WELCOME_ORB_SIZE }} />
            <Skeleton className="h-4 w-56 max-w-full" />
            <SkeletonPanelRows rows={3} leading className="w-full max-w-sm p-0" />
        </div>
    )
}
