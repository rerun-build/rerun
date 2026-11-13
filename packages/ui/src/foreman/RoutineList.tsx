'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'

import { cn } from '../cn'
import { Input, useRenameField } from '../forms'
import { ChevronDownIcon } from '../icons'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'
import { ScrollFade, Switch } from '../primitives'
import { TooltipDisabledReason } from '../Tooltip'
import { groupByPeriod, isWithinTheHour } from './periods'
import { useKitTranslations } from '../locale'
import type { KitTranslator } from '../kit-translator'

const EASE = [0.22, 1, 0.36, 1] as const
const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type RoutineEntry = {
    slug: string
    name: string
    agentId: string
    enabled: boolean
    /** The rule in words ("Every day at 8:15 AM"), resolved by the caller: this package reads no cron. */
    frequency: string
    /** Already resolved against `now`: the list sorts and groups on it, it does not read a cron. */
    nextRunAt: string | null
    runningSince: string | null
    /** The coworker's install is still running, so its routines cannot be switched on yet. */
    setupPending?: boolean
}

export type RoutineListProps<T extends RoutineEntry> = {
    routines: T[]
    now: number
    agentNameOf: (agentId: string) => string
    onOpen: (routine: T) => void
    /** Left out, the switch only shows the state: the landing demo has nothing to save it to. */
    onToggle?: (routine: T, enabled: boolean) => void
    isSaving?: (routine: T) => boolean
    renderMenu?: (routine: T) => ReactNode
    renamingKey?: string | null
    onRename?: (routine: T, name: string) => void
    onCancelRename?: () => void
    /** Docked in dark mode the column sits on the frame colour, and the sticky headings have to match it. */
    docked?: boolean
    className?: string
}

export function routineKey(routine: Pick<RoutineEntry, 'agentId' | 'slug'>): string {
    return `${routine.agentId}:${routine.slug}`
}

function byNextRun(a: RoutineEntry, b: RoutineEntry): number {
    if (a.nextRunAt === b.nextRunAt) return a.name.localeCompare(b.name)
    if (!a.nextRunAt) return 1
    if (!b.nextRunAt) return -1
    return a.nextRunAt.localeCompare(b.nextRunAt)
}

export function RoutineList<T extends RoutineEntry>({ routines, now, docked = false, className, ...rowProps }: RoutineListProps<T>) {
    const t = useKitTranslations()
    const [pausedOpen, setPausedOpen] = useState(false)
    const groups = useMemo(() => groupByPeriod([...routines].sort(byNextRun), now), [routines, now])

    let lineIndex = 0

    return (
        <div className={cn('flex flex-col', className)}>
            <ScrollFade className="min-h-0 flex-1 px-3 pb-4">
                {groups.map((group, groupIndex) => {
                    const isPaused = group.key === 'paused'
                    const open = !isPaused || pausedOpen
                    const heading = (
                        <>
                            {t(`foreman.periods.${group.key}`)}
                            <span className="text-sm font-normal text-muted-foreground tabular-nums">{group.routines.length}</span>
                        </>
                    )
                    return (
                        <section key={group.key}>
                            <div className={cn('sticky top-0 z-10 -mx-3 flex items-center bg-background px-4 pb-2.5', groupIndex === 0 ? 'pt-2' : 'pt-7', docked && 'dark:md:bg-frame')}>
                                {isPaused ? (
                                    <button type="button" onClick={() => setPausedOpen(value => !value)} className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-foreground">
                                        {heading}
                                        <ChevronDownIcon className={cn('size-3.5 self-center text-muted-foreground transition-transform duration-200', pausedOpen && 'rotate-180')} />
                                    </button>
                                ) : (
                                    <h3 className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-foreground">{heading}</h3>
                                )}
                            </div>
                            <AnimatePresence initial={false}>
                                {open && (
                                    <motion.div
                                        initial={isPaused ? { height: 0, opacity: 0 } : false}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.25, ease: EASE }}
                                        className="overflow-hidden"
                                    >
                                        <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-muted/20">
                                            {group.routines.map(routine => (
                                                <motion.div
                                                    key={routineKey(routine)}
                                                    layout="position"
                                                    initial={{ opacity: 0, y: 4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.3, ease: EASE, delay: Math.min(lineIndex++, 12) * 0.02 }}
                                                >
                                                    <RoutineRow routine={routine} now={now} {...rowProps} />
                                                </motion.div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </section>
                    )
                })}
            </ScrollFade>
        </div>
    )
}

type RoutineRowProps<T extends RoutineEntry> = Omit<RoutineListProps<T>, 'routines' | 'docked' | 'className'> & { routine: T }

function RoutineRow<T extends RoutineEntry>({ routine, now, agentNameOf, onOpen, onToggle, isSaving, renderMenu, renamingKey, onRename, onCancelRename }: RoutineRowProps<T>) {
    const t = useKitTranslations()
    const renaming = renamingKey === routineKey(routine)
    const open = () => !renaming && onOpen(routine)
    const rule = [routine.frequency, agentNameOf(routine.agentId)].filter(Boolean).join(' · ')
    const blockedBySetup = Boolean(routine.setupPending) && !routine.enabled

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={event => event.target === event.currentTarget && event.key === 'Enter' && open()}
            className="group flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/30"
        >
            <span className="shrink-0">
                <AgentBuddy agentId={routine.agentId} size={28} animated={false} facing="right" mood={routine.enabled ? 'idle' : 'asleep'} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {renaming ? (
                    <RenameField name={routine.name} onSubmit={name => onRename?.(routine, name)} onCancel={() => onCancelRename?.()} />
                ) : (
                    <span className={cn('truncate text-sm font-medium', routine.enabled ? 'text-foreground' : 'text-muted-foreground')}>{routine.name}</span>
                )}
                <StatusSubline routine={routine} now={now} rule={rule} />
            </div>
            <span className="flex shrink-0 items-center gap-1" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                {onToggle ? (
                    <TooltipDisabledReason reason={blockedBySetup ? t('foreman.routines.setupFirst') : undefined} side="left" className="rounded-full">
                        <Switch
                            checked={routine.enabled}
                            disabled={blockedBySetup || isSaving?.(routine)}
                            onCheckedChange={enabled => onToggle(routine, enabled)}
                            aria-label={routine.enabled ? t('foreman.routines.pause', { name: routine.name }) : t('foreman.routines.resume', { name: routine.name })}
                        />
                    </TooltipDisabledReason>
                ) : (
                    <Switch checked={routine.enabled} tabIndex={-1} aria-hidden className="pointer-events-none" />
                )}
                {renderMenu?.(routine)}
            </span>
        </div>
    )
}

type RoutineStatus = { tone: 'running' | 'soon'; label: string }

function runningLabel(since: string, now: number, t: KitTranslator): string {
    const ms = Math.max(0, now - new Date(since).getTime())
    if (ms < MINUTE) return t('foreman.routines.runningJustNow')
    if (ms < HOUR) return t('foreman.routines.runningMinutes', { minutes: Math.floor(ms / MINUTE) })
    return t('foreman.routines.runningHours', { hours: Math.floor(ms / HOUR) })
}

function startsLabel(at: string, now: number, t: KitTranslator): string {
    const ms = new Date(at).getTime() - now
    if (ms < MINUTE) return t('foreman.routines.startsNow')
    if (ms < HOUR) return t('foreman.routines.startsInMinutes', { minutes: Math.floor(ms / MINUTE) })
    return t('foreman.routines.startsInHours', { hours: Math.floor(ms / HOUR) })
}

function statusOf(routine: RoutineEntry, now: number, t: KitTranslator): RoutineStatus | null {
    if (routine.runningSince) return { tone: 'running', label: runningLabel(routine.runningSince, now, t) }
    if (routine.enabled && routine.nextRunAt && isWithinTheHour(routine.nextRunAt, now)) return { tone: 'soon', label: startsLabel(routine.nextRunAt, now, t) }
    return null
}

// A live status takes the line; hovering it (or focusing the row) brings the rule back in its place.
function StatusSubline({ routine, now, rule }: { routine: RoutineEntry; now: number; rule: string }) {
    const t = useKitTranslations()
    const ruleText = <span className="truncate text-muted-foreground">{rule}</span>
    const status = statusOf(routine, now, t)
    if (!status) return <span className="flex min-w-0 text-xs">{ruleText}</span>

    return (
        <span className="group/status grid w-fit max-w-full min-w-0 text-xs">
            <span
                className={cn(
                    'flex min-w-0 items-center gap-1.5 transition-opacity duration-200 [grid-area:1/1] group-hover/status:opacity-0 group-focus-visible:opacity-0',
                    status.tone === 'running' ? 'text-emerald-600 dark:text-emerald-400' : 'text-brand-text'
                )}
            >
                <LiveDot tone={status.tone} />
                <span className="truncate tabular-nums">{status.label}</span>
            </span>
            <span className="flex min-w-0 opacity-0 transition-opacity duration-200 [grid-area:1/1] group-hover/status:opacity-100 group-focus-visible:opacity-100">{ruleText}</span>
        </span>
    )
}

function LiveDot({ tone }: { tone: RoutineStatus['tone'] }) {
    const color = tone === 'running' ? 'bg-emerald-400' : 'bg-brand-text'
    return (
        <span className="relative flex size-1.5 shrink-0">
            <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} />
            <span className={cn('relative inline-flex size-full rounded-full', color)} />
        </span>
    )
}

function RenameField({ name, onSubmit, onCancel }: { name: string; onSubmit: (name: string) => void; onCancel: () => void }) {
    const t = useKitTranslations()
    const { inputProps } = useRenameField({ name, onSubmit, onCancel })
    return <Input {...inputProps} maxLength={120} aria-label={t('foreman.routines.nameLabel')} className="-ml-1.5 h-6 px-1.5 text-sm font-medium" />
}
