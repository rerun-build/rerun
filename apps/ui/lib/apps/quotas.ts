// The daily and weekly limits a paid app puts on each connected account, and the counters they are
// claimed against (claim_app_quota). Each app writes its own table; every limit can be raised from
// the env without a deploy of code, e.g. LINKEDIN_QUOTA_INVITATION_DAY=40.

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
    quotaRefusal: (action: A, env?: Env) => string
}

export function defineQuotas<A extends string>({ envPrefix, limits, nouns, refusal }: { envPrefix: string; limits: Record<A, QuotaLimit[]>; nouns: Record<A, string>; refusal: (noun: string, windows: string, action: A) => string }): QuotaTable<A> {
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
        quotaRefusal: (action, env = process.env) => refusal(nouns[action], quotaLimits(action, env).map(limit => `${limit.max} per ${limit.window}`).join(', '), action),
    }
}

// Wake-ups from provider events, per connection and per day: an inbox flooded by a campaign must not
// turn into hundreds of runs billed to the workspace.
export const DAILY_WAKE_LIMIT = 200

// Our own connect form, per workspace, per app and per day: it must not serve as a password tester
// against LinkedIn, nor as a way to open accounts at Linkup by the dozen.
export const DAILY_LOGIN_ATTEMPT_LIMIT = 10
