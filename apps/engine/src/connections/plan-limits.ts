import { opencodeUsageSchema, planLimitWindowSchema, type PlanLimitWindow, type PlanLimits } from '@moldwright/contracts'
import { latestReadings, saveReadings } from './plan-readings.js'

const readings = new Map<string, PlanLimits>()

export function recordPlanLimits(connectionId: string, windows: PlanLimitWindow[]): void {
    if (!windows.length) return
    const capturedAt = new Date().toISOString()
    readings.set(connectionId, { windows, capturedAt })
    void saveReadings(connectionId, windows, capturedAt).catch(() => {})
}

export function readPlanLimits(connectionId: string): PlanLimits | null {
    return readings.get(connectionId) ?? null
}

const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60_000

export async function restorePlanLimits(now = Date.now()): Promise<void> {
    const saved = new Map<string, PlanLimits>()
    for (const reading of await latestReadings(new Date(now - RESTORE_WINDOW_MS).toISOString())) {
        const window = planLimitWindowSchema.safeParse({ kind: reading.kind, label: reading.label || null, usedPercent: reading.usedPercent, resetsAt: reading.resetsAt })
        if (!window.success) continue
        const held = saved.get(reading.connectionId) ?? { windows: [], capturedAt: reading.capturedAt }
        saved.set(reading.connectionId, { windows: [...held.windows, window.data], capturedAt: reading.capturedAt > held.capturedAt ? reading.capturedAt : held.capturedAt })
    }
    for (const [connectionId, limits] of saved) if (!readings.has(connectionId)) readings.set(connectionId, limits)
}

export function forgetPlanLimits(connectionId: string): void {
    readings.delete(connectionId)
}

type ClaudeWindow = { utilization?: number | null; resets_at?: string | null } | null

export type ClaudePlanUsage = {
    rate_limits?: {
        five_hour?: ClaudeWindow
        seven_day?: ClaudeWindow
        seven_day_opus?: ClaudeWindow
        seven_day_sonnet?: ClaudeWindow
        model_scoped?: ({ display_name?: string } & NonNullable<ClaudeWindow>)[]
    } | null
}

function claudeWindow(kind: PlanLimitWindow['kind'], label: string | null, window: ClaudeWindow | undefined): PlanLimitWindow[] {
    if (typeof window?.utilization !== 'number') return []
    return [{ kind, label, usedPercent: window.utilization, resetsAt: window.resets_at ?? null }]
}

export function planLimitWindowsFromClaude(usage: ClaudePlanUsage | null | undefined): PlanLimitWindow[] {
    const limits = usage?.rate_limits
    if (!limits) return []
    const scoped = (limits.model_scoped ?? []).flatMap(w => claudeWindow('model', w.display_name ?? null, w))
    const models = scoped.length ? scoped : [...claudeWindow('model', 'Opus', limits.seven_day_opus), ...claudeWindow('model', 'Sonnet', limits.seven_day_sonnet)]
    return [...claudeWindow('session', null, limits.five_hour), ...claudeWindow('weekly', null, limits.seven_day), ...models]
}

type ClaudeLimit = { kind?: string; percent?: number | null; resets_at?: string | null; scope?: { model?: { display_name?: string | null } | null } | null } | null

export type ClaudeUsageAnswer = Omit<NonNullable<ClaudePlanUsage['rate_limits']>, 'model_scoped'> & { limits?: ClaudeLimit[] | null }

export function planLimitWindowsFromClaudeUsage(answer: ClaudeUsageAnswer | null | undefined): PlanLimitWindow[] {
    if (!answer || typeof answer !== 'object') return []
    const modelScoped = (Array.isArray(answer.limits) ? answer.limits : []).flatMap(limit => {
        const name = limit?.kind === 'weekly_scoped' ? limit.scope?.model?.display_name : null
        return name ? [{ display_name: name, utilization: limit?.percent ?? null, resets_at: limit?.resets_at ?? null }] : []
    })
    return planLimitWindowsFromClaude({
        rate_limits: { five_hour: answer.five_hour, seven_day: answer.seven_day, seven_day_opus: answer.seven_day_opus, seven_day_sonnet: answer.seven_day_sonnet, model_scoped: modelScoped },
    })
}

type CodexWindow = { usedPercent?: number | null; windowDurationMins?: number | null; resetsAt?: number | null } | null

export type CodexRateLimits = { rateLimits?: { primary?: CodexWindow; secondary?: CodexWindow } | null }

const DAY_MINUTES = 24 * 60

function codexWindow(window: CodexWindow | undefined, fallback: PlanLimitWindow['kind']): PlanLimitWindow[] {
    if (typeof window?.usedPercent !== 'number') return []
    const kind = typeof window.windowDurationMins === 'number' ? (window.windowDurationMins <= DAY_MINUTES ? 'session' : 'weekly') : fallback
    const resetsAt = typeof window.resetsAt === 'number' ? new Date(window.resetsAt * 1000).toISOString() : null
    return [{ kind, label: null, usedPercent: window.usedPercent, resetsAt }]
}

export function planLimitWindowsFromCodex(response: CodexRateLimits | null | undefined): PlanLimitWindow[] {
    const limits = response?.rateLimits
    if (!limits) return []
    return [...codexWindow(limits.primary, 'session'), ...codexWindow(limits.secondary, 'weekly')]
}

const OPENCODE_WINDOWS = [
    ['rolling', 'session'],
    ['weekly', 'weekly'],
    ['monthly', 'monthly'],
] as const

export function planLimitWindowsFromOpencode(body: unknown): PlanLimitWindow[] {
    const parsed = opencodeUsageSchema.safeParse(body)
    if (!parsed.success) return []
    return OPENCODE_WINDOWS.flatMap(([field, kind]) => {
        const window = parsed.data.usage[field]
        if (!window) return []
        const usedPercent = window.status === 'ok' ? window.percent : Math.max(window.percent, 100)
        return [{ kind, label: null, usedPercent, resetsAt: window.resetsAt ?? null }]
    })
}

export function spentPlanWindow(connectionId: string): PlanLimitWindow | null {
    return readings.get(connectionId)?.windows.find(window => window.usedPercent >= 100) ?? null
}

const PLAN_LIMIT_PROBE_MS = 30 * 60_000

const limitLatches = new Map<string, number>()

export function armPlanLimitLatch(connectionId: string, now = Date.now()): void {
    limitLatches.set(connectionId, now)
}

export function clearPlanLimitLatch(connectionId: string): void {
    limitLatches.delete(connectionId)
}

export function isPlanLimitLatched(connectionId: string, now = Date.now()): boolean {
    const armedAt = limitLatches.get(connectionId)
    if (armedAt === undefined) return false
    const resetsAt = Date.parse(spentPlanWindow(connectionId)?.resetsAt ?? '')
    return now < (resetsAt > armedAt ? resetsAt : armedAt + PLAN_LIMIT_PROBE_MS)
}
