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

type ClaudeLimit = { kind?: string; percent?: number | null; resets_at?: string | null; scope?: { model?: { display_name?: string | null } | null } | null } | null

// The answer of `GET /api/oauth/usage`, the endpoint behind the CLI's `/usage`. It carries the same
// fixed windows as the CLI's reading, and names the per-model buckets in `limits` rather than in
// `model_scoped`.
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

type GrokPeriod = { type?: unknown; start?: unknown; end?: unknown } | null | undefined
type GrokBilling = { config?: { creditUsagePercent?: unknown; currentPeriod?: GrokPeriod } | null } | null

const GROK_PERIOD_KINDS: Record<string, PlanLimitWindow['kind']> = { USAGE_PERIOD_TYPE_WEEKLY: 'weekly', USAGE_PERIOD_TYPE_MONTHLY: 'monthly' }
const DAY_MS = 86_400_000

// A period of a type the proxy did not name yet is read off its length, and only when it looks
// like a week or a month.
function grokPeriodKind(period: NonNullable<GrokPeriod>): PlanLimitWindow['kind'] | null {
    if (typeof period.type === 'string' && GROK_PERIOD_KINDS[period.type]) return GROK_PERIOD_KINDS[period.type]!
    const days = (Date.parse(String(period.end)) - Date.parse(String(period.start))) / DAY_MS
    if (days >= 6 && days <= 8) return 'weekly'
    if (days >= 27 && days <= 32) return 'monthly'
    return null
}

// Grok Build's `/billing?format=credits`: one window, the share of the period's allowance spent. The
// proxy leaves the share out while nothing of the period is spent. Any other shape reads as no
// reading at all: no gauge is better than a wrong one.
export function planLimitWindowsFromGrok(body: unknown): PlanLimitWindow[] {
    const config = (body as GrokBilling)?.config
    const period = config?.currentPeriod
    if (!config || typeof config !== 'object' || !period || typeof period !== 'object') return []
    const share = config.creditUsagePercent
    if (share !== undefined && (typeof share !== 'number' || !Number.isFinite(share))) return []
    const kind = grokPeriodKind(period)
    if (!kind) return []
    const resetsAt = typeof period.end === 'string' && Number.isFinite(Date.parse(period.end)) ? new Date(period.end).toISOString() : null
    return [{ kind, label: null, usedPercent: share ?? 0, resetsAt }]
}

// The window a refused call ran into, when the last reading says one is spent.
export function spentPlanWindow(connectionId: string): PlanLimitWindow | null {
    return readings.get(connectionId)?.windows.find(window => window.usedPercent >= 100) ?? null
}

// A spent subscription fails every run within seconds until its window resets, so the scheduler
// holds the connection's schedules until then. The reset time is read when the hold is checked, not
// when it is armed: every provider refreshes its windows during the run's teardown, seconds after
// the refusal armed the hold, so the reading a refused run leaves behind can still be under 100%
// when the hold is armed. Without a reset time the hold lasts
// PLAN_LIMIT_PROBE_MS, and the next due run is the probe.
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
