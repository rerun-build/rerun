// The daily and weekly pace a paid app recommends for each connected account, and the counters it is
// measured against (count_app_usage). A pace never refuses a call: past it, the tool adds a notice so
// the coworker tells the user the risk, and the user decides. Each app writes its own table; every
// pace can be changed from the env without a deploy of code, e.g. LINKEDIN_QUOTA_INVITATION_DAY=40.

export type QuotaWindow = 'day' | 'week'

export type QuotaLimit = { window: QuotaWindow; max: number }

type Env = Record<string, string | undefined>

export function dayKey(at: Date): string {
    return at.toISOString().slice(0, 10)
}

// ISO 8601 week, so a week starts on Monday in UTC whatever the server's locale.
export function isoWeekKey(at: Date): string {
    const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
    const weekday = day.getUTCDay() || 7
    day.setUTCDate(day.getUTCDate() + 4 - weekday)
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
    return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function periodKey(window: QuotaWindow, at: Date): string {
    return window === 'day' ? dayKey(at) : isoWeekKey(at)
}

export type QuotaTable<A extends string> = {
    quotaLimits: (action: A, env?: Env) => QuotaLimit[]
    quotaClaim: (action: A, at: Date, env?: Env) => { periods: string[]; maxes: number[] }
    // The counts are those of quotaClaim's periods, after the call: null while none is past its pace.
    quotaNotice: (action: A, counts: number[], env?: Env) => string | null
    quotaPace: (action: A, env?: Env) => string
}

const WINDOW_NOW: Record<QuotaWindow, string> = { day: 'today', week: 'this week' }

export function defineQuotas<A extends string>({ envPrefix, limits, nouns, notice }: { envPrefix: string; limits: Record<A, QuotaLimit[]>; nouns: Record<A, string>; notice: (noun: string, overage: string, action: A) => string }): QuotaTable<A> {
    const override = (action: A, window: QuotaWindow, env: Env): number | null => {
        const raw = env[`${envPrefix}_${action.toUpperCase()}_${window.toUpperCase()}`]
        if (!raw) return null
        const value = Number(raw)
        return Number.isInteger(value) && value >= 0 ? value : null
    }
    const quotaLimits = (action: A, env: Env = process.env) => limits[action].map(limit => ({ window: limit.window, max: override(action, limit.window, env) ?? limit.max }))
    return {
        quotaLimits,
        quotaClaim: (action, at, env = process.env) => {
            const current = quotaLimits(action, env)
            return { periods: current.map(limit => periodKey(limit.window, at)), maxes: current.map(limit => limit.max) }
        },
        quotaNotice: (action, counts, env = process.env) => {
            const past = quotaLimits(action, env)
                .map((limit, index) => ({ ...limit, count: counts[index] ?? 0 }))
                .filter(limit => limit.count > limit.max)
            if (past.length === 0) return null
            return notice(nouns[action], past.map(limit => `${limit.count} ${WINDOW_NOW[limit.window]}, ${limit.max} per ${limit.window} recommended`).join('; '), action)
        },
        quotaPace: (action, env = process.env) => `Recommended ${nouns[action]} pace for this account: ${quotaLimits(action, env).map(limit => `${limit.max} per ${limit.window}`).join(', ')}.`,
    }
}

// Wake-ups from provider events, per connection and per day: an inbox flooded by a campaign must not
// turn into hundreds of runs billed to the workspace.
export const DAILY_WAKE_LIMIT = 200

// Our own connect form, per workspace, per app and per day: it must not serve as a password tester
// against LinkedIn, nor as a way to open accounts at Linkup by the dozen.
export const DAILY_LOGIN_ATTEMPT_LIMIT = 10
