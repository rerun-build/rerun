import { formatDate } from '@rerun/i18n/format'

import { englishKitTranslator, type KitTranslator } from '../kit-translator'

export type ScheduleChoice = { kind: 'described' } | { kind: 'preset'; id: SchedulePresetId } | { kind: 'custom'; days: boolean[]; time: string } | { kind: 'on-demand' }

export type SchedulePresetId = 'weekday' | 'monday'

export const SCHEDULE_PRESETS: { id: SchedulePresetId; phrase: string }[] = [
    { id: 'weekday', phrase: 'every weekday at 9:00' },
    { id: 'monday', phrase: 'every Monday at 9:00' },
]

export const DESCRIBED: ScheduleChoice = { kind: 'described' }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function dayNames(locale: string): string[] {
    if (locale === 'en') return DAYS
    return DAYS.map((_, index) => formatDate(Date.UTC(2024, 0, 1 + index), locale, { weekday: 'long', timeZone: 'UTC' }))
}

export function dayInitials(locale: string): string[] {
    return dayNames(locale).map(day => day.charAt(0).toUpperCase())
}

export const DEFAULT_CUSTOM: Extract<ScheduleChoice, { kind: 'custom' }> = { kind: 'custom', days: [true, true, true, true, true, false, false], time: '09:00' }

export function toggleDay(days: boolean[], index: number): boolean[] {
    const next = days.map((on, i) => (i === index ? !on : on))
    return next.some(Boolean) ? next : days
}

function clock(time: string): string {
    const [hours, minutes] = time.split(':')
    return `${Number(hours)}:${minutes ?? '00'}`
}

function daysPhrase(days: boolean[]): string {
    const on = DAYS.filter((_, index) => days[index])
    if (on.length === DAYS.length) return 'every day'
    if (on.length === 5 && !days[5] && !days[6]) return 'every weekday'
    if (on.length === 1) return `every ${on[0]}`
    return `every ${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}`
}

function phrase(choice: Extract<ScheduleChoice, { kind: 'preset' | 'custom' }>): string {
    if (choice.kind === 'preset') return SCHEDULE_PRESETS.find(preset => preset.id === choice.id)?.phrase ?? ''
    return `${daysPhrase(choice.days)} at ${clock(choice.time)}`
}

export function scheduleLabel(choice: ScheduleChoice, t: KitTranslator = englishKitTranslator, locale = 'en'): string | null {
    if (choice.kind === 'described') return null
    if (choice.kind === 'on-demand') return t('newAgent.schedule.onDemand')
    if (choice.kind === 'preset') return t(`newAgent.schedule.presets.${choice.id}.label`)
    const time = clock(choice.time)
    const on = dayNames(locale).filter((_, index) => choice.days[index])
    if (on.length === DAYS.length) return t('newAgent.schedule.everyDay', { time })
    if (on.length === 5 && !choice.days[5] && !choice.days[6]) return t('newAgent.schedule.everyWeekday', { time })
    const days = new Intl.ListFormat(locale === 'en' ? 'en-GB' : locale, { type: 'conjunction' }).format(on)
    return t('newAgent.schedule.everyDays', { days, time })
}

export function buildKickoff(description: string, choice: ScheduleChoice, timeZone: string | null): string {
    const job = description.trim()
    if (choice.kind === 'described') return job
    if (choice.kind === 'on-demand') return `${job}\n\nDo not set up any schedule: only run this when I ask.`
    const zone = timeZone ? ` (${timeZone} time)` : ''
    return `${job}\n\nRun this ${phrase(choice)}${zone}. Set up the schedule yourself.`
}
