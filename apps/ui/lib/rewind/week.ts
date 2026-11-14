const DAY_MS = 24 * 60 * 60 * 1000

export type RewindWeek = { weekStart: string; from: string; to: string }

function mondayOf(date: Date): Date {
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    const daysSinceMonday = (date.getUTCDay() + 6) % 7
    return new Date(midnight - daysSinceMonday * DAY_MS)
}

export function rewindWeekStarting(monday: Date): RewindWeek {
    const start = mondayOf(monday)
    return {
        weekStart: start.toISOString().slice(0, 10),
        from: start.toISOString(),
        to: new Date(start.getTime() + 7 * DAY_MS).toISOString(),
    }
}

export function lastCompletedWeek(now: Date): RewindWeek {
    return rewindWeekStarting(new Date(mondayOf(now).getTime() - 7 * DAY_MS))
}

export function weekBefore(week: RewindWeek): RewindWeek {
    return rewindWeekStarting(new Date(Date.parse(week.from) - 7 * DAY_MS))
}

export function weekEndOf(weekStart: string): string {
    return new Date(Date.parse(`${weekStart}T00:00:00.000Z`) + 7 * DAY_MS).toISOString()
}
