'use client'

import { type ReactNode, useState } from 'react'

import { CalendarIcon, CheckIcon, GlobeIcon, MessageSquareTextIcon } from '../icons'
import type { JobSchedule } from './reading'
import { dayInitials, DEFAULT_CUSTOM, DESCRIBED, SCHEDULE_PRESETS, type ScheduleChoice, toggleDay } from './schedule'
import { timeZoneOffset, useTimeZone } from './useTimeZone'
import type { CatalogEntry } from './types'
import { cn } from '../cn'
import { useKitTranslations, useUiLocale } from '../locale'

import { AppLogo } from './marks'

// Three ways for the agent to start, one per block: the timing read in the description first and
// ticked until another is picked, then the clock (two presets and a custom week), then on demand.
// The time zone closes it, quiet, since every hour above depends on it. Picking the ticked option
// again gives the timing back to the description.
export function SchedulePlanner({ read, app, choice, onChoice }: { read: JobSchedule | null; app?: CatalogEntry; choice: ScheduleChoice; onChoice: (choice: ScheduleChoice) => void }) {
    const t = useKitTranslations()
    const [lastCustom, setLastCustom] = useState(DEFAULT_CUSTOM)
    const custom = choice.kind === 'custom' ? choice : lastCustom
    const timeZone = useTimeZone()

    function pick(next: ScheduleChoice, selected: boolean) {
        onChoice(selected ? DESCRIBED : next)
    }

    function setCustom(next: typeof custom) {
        setLastCustom(next)
        onChoice(next)
    }

    return (
        <div className="text-[13px]">
            {read && (
                <>
                    <button type="button" aria-pressed={choice.kind === 'described'} onClick={() => onChoice(DESCRIBED)} className={cn('flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors', choice.kind === 'described' ? 'bg-muted/60' : 'hover:bg-muted/40')}>
                        {app ? <AppLogo app={app} className="mt-px" /> : <span className="size-4 shrink-0" />}
                        <span className="min-w-0 flex-1">
                            <span className="block leading-[18px] text-foreground">{read.label}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{t('newAgent.schedule.readFromDescription')}</span>
                        </span>
                        {choice.kind === 'described' && <CheckIcon className="mt-px size-4 shrink-0 text-foreground" />}
                    </button>
                    <Divider />
                </>
            )}
            <p className="flex h-7 items-center gap-2.5 px-2 text-xs font-medium text-muted-foreground">
                <CalendarIcon className="size-4" />
                {t('newAgent.schedule.onASchedule')}
            </p>
            {SCHEDULE_PRESETS.map(preset => {
                const selected = choice.kind === 'preset' && choice.id === preset.id
                return (
                    <Option key={preset.id} aim={preset.id} selected={selected} detail={t(`newAgent.schedule.presets.${preset.id}.detail`)} onClick={() => pick({ kind: 'preset', id: preset.id }, selected)}>
                        {t(`newAgent.schedule.presets.${preset.id}.label`)}
                    </Option>
                )
            })}
            <div className={cn('flex h-8 items-center gap-2.5 rounded-md pr-2 transition-colors', choice.kind === 'custom' ? 'bg-muted/60' : 'hover:bg-muted/40')}>
                <button type="button" aria-pressed={choice.kind === 'custom'} onClick={() => pick(custom, choice.kind === 'custom')} className="flex h-full flex-1 items-center gap-2.5 pl-2 text-left">
                    <Tick selected={choice.kind === 'custom'} />
                    <span className="text-foreground/90">{t('newAgent.schedule.custom')}</span>
                </button>
                <CustomWeek days={custom.days} time={custom.time} onDays={days => setCustom({ ...custom, days })} onTime={time => setCustom({ ...custom, time })} />
            </div>

            <Divider />
            <Option icon={<MessageSquareTextIcon className="size-4 text-muted-foreground" />} selected={choice.kind === 'on-demand'} detail={t('newAgent.schedule.noSchedule')} onClick={() => pick({ kind: 'on-demand' }, choice.kind === 'on-demand')}>
                {t('newAgent.schedule.onDemand')}
            </Option>

            {timeZone && (
                <>
                    <Divider />
                    <p className="flex h-7 items-center gap-2.5 px-2 text-xs text-muted-foreground/60">
                        <GlobeIcon className="size-4" />
                        {[timeZone, timeZoneOffset(timeZone)].filter(Boolean).join(' · ')}
                    </p>
                </>
            )}
        </div>
    )
}

function Tick({ selected, icon }: { selected: boolean; icon?: ReactNode }) {
    return <span className="flex w-4 shrink-0 justify-center">{selected ? <CheckIcon className="size-4 text-foreground" /> : icon}</span>
}

function Option({ icon, aim, selected, detail, onClick, children }: { icon?: ReactNode; aim?: string; selected: boolean; detail: ReactNode; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" data-aim={aim} aria-pressed={selected} onClick={onClick} className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors', selected ? 'bg-muted/60' : 'hover:bg-muted/40')}>
            <Tick selected={selected} icon={icon} />
            <span className="text-foreground/90">{children}</span>
            <span className="ml-auto text-xs text-muted-foreground">{detail}</span>
        </button>
    )
}

function CustomWeek({ days, time, onDays, onTime }: { days: boolean[]; time: string; onDays: (days: boolean[]) => void; onTime: (time: string) => void }) {
    const t = useKitTranslations()
    const locale = useUiLocale()
    return (
        <span className="flex items-center gap-2">
            <span className="flex items-center gap-[3px]">
                {dayInitials(locale).map((day, index) => (
                    <button key={index} type="button" aria-pressed={days[index]} onClick={() => onDays(toggleDay(days, index))} className={cn('flex size-5 items-center justify-center rounded-[5px] text-[10px] font-medium transition-colors', days[index] ? 'bg-black/[0.07] text-foreground/85 dark:bg-white/[0.09]' : 'text-muted-foreground/50 inset-ring inset-ring-black/[0.08] hover:text-foreground dark:inset-ring-white/[0.06]')}>
                        {day}
                    </button>
                ))}
            </span>
            <input type="time" value={time} onChange={event => event.target.value && onTime(event.target.value)} aria-label={t('newAgent.schedule.timeOfDay')} className="h-5 rounded-[5px] bg-black/[0.05] px-1.5 text-xs text-foreground/85 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-white/[0.06] [&::-webkit-calendar-picker-indicator]:hidden" />
        </span>
    )
}

function Divider() {
    return <div className="-mx-1.5 my-1.5 h-px bg-border" />
}
