import { formatDate } from '@rerun/i18n/format'
import { useLocale } from 'next-intl'

import { cn } from '@/lib/utils'

export type CancelMilestone = { at: number; label: string; date: Date; highlighted?: boolean }

// The brand indigo is too dark to read as text on the dark theme; the badges switch to the same lilac.
export const BRAND_TEXT = 'text-brand dark:text-[#b7a8ff]'

// Not to scale: a reminder a week before a monthly renewal would sit flush against it and the two
// labels would overlap.
const MIDDLE_MILESTONE_RANGE = [0.35, 0.6] as const

function milestonePosition(at: number) {
    if (at === 0 || at === 1) return at
    const [min, max] = MIDDLE_MILESTONE_RANGE
    return Math.min(max, Math.max(min, at))
}

export function CancelTimeline({ milestones }: { milestones: readonly CancelMilestone[] }) {
    return (
        <div className="relative mx-1 h-[4.75rem]">
            <div className="absolute inset-x-5 top-[21px] h-1 rounded-full bg-muted" />
            <div className="absolute top-[21px] left-5 h-1 w-[10%] rounded-full bg-gradient-to-r from-foreground/70 to-transparent" />
            {milestones.map(milestone => (
                <div
                    key={milestone.label}
                    className={cn('absolute top-0 flex flex-col gap-2', milestone.at === 0 ? 'items-start' : milestone.at === 1 ? '-translate-x-full items-end' : '-translate-x-1/2 items-center')}
                    style={{ left: `${milestonePosition(milestone.at) * 100}%` }}
                >
                    <CalendarTile date={milestone.date} highlighted={milestone.highlighted} />
                    <span className={cn('text-xs whitespace-nowrap', milestone.highlighted ? 'font-medium text-foreground' : 'text-muted-foreground')}>{milestone.label}</span>
                </div>
            ))}
        </div>
    )
}

function CalendarTile({ date, highlighted }: { date: Date; highlighted?: boolean }) {
    const locale = useLocale()
    return (
        <div className={cn('flex w-10 flex-col overflow-hidden rounded-lg border bg-popover shadow-xs', highlighted && 'border-brand/70 shadow-brand/20 shadow-md')}>
            <span className={cn('flex h-3.5 items-center justify-center text-[9px] leading-none font-semibold tracking-wider uppercase', highlighted ? 'bg-brand text-white' : 'bg-muted text-muted-foreground')}>
                {formatDate(date, locale, { weekday: 'short' })}
            </span>
            <span className={cn('flex h-[1.875rem] items-center justify-center text-base leading-none font-semibold tabular-nums', highlighted ? BRAND_TEXT : 'text-foreground')}>{date.getDate()}</span>
        </div>
    )
}
