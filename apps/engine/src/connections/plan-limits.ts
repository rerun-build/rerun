import { opencodeUsageSchema, type PlanLimitWindow, type PlanLimits } from '@rerun/contracts'

// Kept in memory on purpose: a reading is only as good as its age, and the next run or the next
// read refills it. Nothing here is worth a file a restored data-dir would have to carry.
const readings = new Map<string, PlanLimits>()

export function recordPlanLimits(connectionId: string, windows: PlanLimitWindow[]): void {
    if (!windows.length) return
    readings.set(connectionId, { windows, capturedAt: new Date().toISOString() })
}

export function readPlanLimits(connectionId: string): PlanLimits | null {
    return readings.get(connectionId) ?? null
}

export function forgetPlanLimits(connectionId: string): void {
    readings.delete(connectionId)
}

type ClaudeWindow = { utilization?: number | null; resets_at?: string | null } | null

// The part of Claude Code's `/usage` answer read here. Every field is optional because the SDK
// ships it as experimental: a shape that moved must read as "no reading", never throw.
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
    // `model_scoped` is the newer list and names the same buckets as the two fixed fields, so the
    // fixed fields only speak when it is absent.
    const scoped = (limits.model_scoped ?? []).flatMap(w => claudeWindow('model', w.display_name ?? null, w))
    const models = scoped.length ? scoped : [...claudeWindow('model', 'Opus', limits.seven_day_opus), ...claudeWindow('model', 'Sonnet', limits.seven_day_sonnet)]
    return [...claudeWindow('session', null, limits.five_hour), ...claudeWindow('weekly', null, limits.seven_day), ...models]
}

type CodexWindow = { usedPercent?: number | null; windowDurationMins?: number | null; resetsAt?: number | null } | null

// The part of the app-server's `account/rateLimits/read` answer read here.
export type CodexRateLimits = { rateLimits?: { primary?: CodexWindow; secondary?: CodexWindow } | null }

const DAY_MINUTES = 24 * 60

// Codex does not say which window is which, and a plan with a single weekly cap reports it as
// `primary`. The duration is the only reliable tell; the slot is the fallback when it is missing.
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

// OpenCode Go's `/usage` names its windows outright: `rolling` is the five-hour one. A window it
// answers with a status other than `ok` is spent whatever the percentage says.
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

// The window a refused call ran into, when the last reading says one is spent.
export function spentPlanWindow(connectionId: string): PlanLimitWindow | null {
    return readings.get(connectionId)?.windows.find(window => window.usedPercent >= 100) ?? null
}
