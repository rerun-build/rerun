import { humanCron } from '@/lib/schedules/cron'

export function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

export function scheduleLabel(cron: string, locale: string): string {
    return humanCron(cron, locale) ?? cron
}
