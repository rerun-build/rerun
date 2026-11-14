export type QuotaWindow = 'day' | 'week'

export type QuotaLimit = { window: QuotaWindow; max: number }

type Env = Record<string, string | undefined>

export function dayKey(at: Date): string {
    return at.toISOString().slice(0, 10)
}

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

export function defineQuotas<A extends string>({ envPrefix, limits, nouns, refusal }: { envPrefix: string; limits: Record<A, QuotaLimit[]>; nouns: Record<A, string>; refusal: (noun: string, windows: string) => string }): QuotaTable<A> {
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
        quotaRefusal: (action, env = process.env) => refusal(nouns[action], quotaLimits(action, env).map(limit => `${limit.max} per ${limit.window}`).join(', ')),
    }
}

export const DAILY_WAKE_LIMIT = 200

export const DAILY_LOGIN_ATTEMPT_LIMIT = 10
