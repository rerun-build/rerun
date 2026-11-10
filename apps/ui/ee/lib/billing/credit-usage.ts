import { isPaidDataCapability, paidDataEntry, RERUN_TIERS, type PaidDataCapability, type RerunTier } from '@rerun/contracts'
import { formatDate } from '@rerun/i18n/format'

export type CreditKind = 'ai' | 'data'

export type CreditSource = { kind: 'ai'; tier: RerunTier } | { kind: 'data'; capability: PaidDataCapability }

// `id` is the agents row, what AgentBuddy draws from; null on a charge no coworker can be named for.
export type CreditCoworker = { id: string; name: string } | null

export type CreditUsage = {
    period: { start: string; end: string }
    days: { day: string; aiMicros: number; dataMicros: number }[]
    bySource: { source: CreditSource; micros: number; calls: number }[]
    byCoworker: { coworker: CreditCoworker; aiMicros: number; dataMicros: number }[]
    latest: { day: string; coworker: CreditCoworker; source: CreditSource; micros: number; calls: number }[]
}

// One row of rerun_credit_usage: the credit spent on one UTC day, by one source, by one coworker.
export type CreditUsageRow = { day: string; kind: string; source: string; engine_agent_id: string | null; micros: number; calls: number }

type AgentRow = { id: string; name: string; engine_agent_id: string | null }

const DAY_MS = 86_400_000

const TIER_LABEL: Record<RerunTier, string> = { fast: 'Fast', balanced: 'Balanced', smart: 'Smart' }

export const KIND_LABEL: Record<CreditKind, string> = { ai: 'AI models', data: 'Paid data' }

export function sourceLabel(source: CreditSource): string {
    if (source.kind === 'ai') return `${TIER_LABEL[source.tier]} model`
    const label = paidDataEntry(source.capability).label
    return label.charAt(0).toUpperCase() + label.slice(1)
}

export function sourceKey(source: CreditSource): string {
    return source.kind === 'ai' ? `ai:${source.tier}` : `data:${source.capability}`
}

function sourceOf(row: CreditUsageRow): CreditSource | null {
    if (row.kind === 'ai') return { kind: 'ai', tier: RERUN_TIERS.find(tier => tier === row.source) ?? 'balanced' }
    return isPaidDataCapability(row.source) ? { kind: 'data', capability: row.source } : null
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10)

export function summarizeCreditUsage(rows: CreditUsageRow[], agents: AgentRow[], period: { start: Date; end: Date }, now: Date): CreditUsage {
    const coworkers = new Map(agents.filter(agent => agent.engine_agent_id).map(agent => [agent.engine_agent_id, { id: agent.id, name: agent.name }]))
    const days = new Map<string, { day: string; aiMicros: number; dataMicros: number }>()
    for (let at = new Date(`${utcDay(period.start)}T00:00:00Z`); at <= now; at = new Date(at.getTime() + DAY_MS)) days.set(utcDay(at), { day: utcDay(at), aiMicros: 0, dataMicros: 0 })

    const bySource = new Map<string, CreditUsage['bySource'][number]>()
    const byCoworker = new Map<string, CreditUsage['byCoworker'][number]>()
    const latest: CreditUsage['latest'] = []

    for (const row of rows) {
        const source = sourceOf(row)
        if (!source || row.micros <= 0) continue
        const micros = Number(row.micros)
        const calls = Number(row.calls)
        const coworker = (row.engine_agent_id && coworkers.get(row.engine_agent_id)) || null
        const kindKey = source.kind === 'ai' ? 'aiMicros' : 'dataMicros'

        const day = days.get(row.day) ?? { day: row.day, aiMicros: 0, dataMicros: 0 }
        day[kindKey] += micros
        days.set(row.day, day)

        const sourceTotal = bySource.get(sourceKey(source)) ?? { source, micros: 0, calls: 0 }
        sourceTotal.micros += micros
        sourceTotal.calls += calls
        bySource.set(sourceKey(source), sourceTotal)

        const coworkerTotal = byCoworker.get(coworker?.id ?? '') ?? { coworker, aiMicros: 0, dataMicros: 0 }
        coworkerTotal[kindKey] += micros
        byCoworker.set(coworker?.id ?? '', coworkerTotal)

        const charge = latest.find(entry => entry.day === row.day && entry.coworker?.id === coworker?.id && sourceKey(entry.source) === sourceKey(source))
        if (charge) {
            charge.micros += micros
            charge.calls += calls
        } else latest.push({ day: row.day, coworker, source, micros, calls })
    }

    const coworkerSpend = (total: CreditUsage['byCoworker'][number]) => total.aiMicros + total.dataMicros
    return {
        period: { start: period.start.toISOString(), end: period.end.toISOString() },
        days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
        bySource: [...bySource.values()].sort((a, b) => b.micros - a.micros),
        byCoworker: [...byCoworker.values()].sort((a, b) => (!a.coworker ? 1 : !b.coworker ? -1 : coworkerSpend(b) - coworkerSpend(a))),
        latest: latest.sort((a, b) => b.day.localeCompare(a.day) || b.micros - a.micros).slice(0, 5),
    }
}

export type CreditColumns = { budgetMicros: number; usedMicros: number; topupMicros: number }

export type CreditBalance = {
    usedAiMicros: number
    usedDataMicros: number
    monthLeftMicros: number
    topupLeftMicros: number
    leftMicros: number
    wholeMicros: number
}

// The figures come from the workspace columns, the only exact ones: the events only say how the
// spend splits between the models and paid data. consume_rerun_credit spends the month first and
// takes the top-up down as it goes, so the top-up column is already what is left of it.
export function creditBalance({ budgetMicros, usedMicros, topupMicros }: CreditColumns, usage: Pick<CreditUsage, 'bySource'> | null): CreditBalance {
    const ai = usage?.bySource.filter(total => total.source.kind === 'ai').reduce((sum, total) => sum + total.micros, 0) ?? 0
    const data = usage?.bySource.filter(total => total.source.kind === 'data').reduce((sum, total) => sum + total.micros, 0) ?? 0
    const usedDataMicros = ai + data > 0 ? Math.round((usedMicros * data) / (ai + data)) : 0
    const monthLeftMicros = Math.max(budgetMicros - usedMicros, 0)
    return {
        usedAiMicros: usedMicros - usedDataMicros,
        usedDataMicros,
        monthLeftMicros,
        topupLeftMicros: topupMicros,
        leftMicros: monthLeftMicros + topupMicros,
        wholeMicros: Math.max(budgetMicros, usedMicros) + topupMicros,
    }
}

// The day the credit runs out if the coworkers keep spending at the pace they have so far, or null
// when it lasts until the period ends.
export function runsOutOn(balance: CreditBalance, period: { start: string; end: string }, now: Date): Date | null {
    const used = balance.usedAiMicros + balance.usedDataMicros
    if (used <= 0) return null
    const perDay = used / Math.max((now.getTime() - new Date(period.start).getTime()) / DAY_MS, 1)
    const out = new Date(now.getTime() + (balance.leftMicros / perDay) * DAY_MS)
    return out < new Date(period.end) ? out : null
}

// The days are UTC days, as rerun_credit_usage buckets them: shown as such, whatever the browser's zone.
export function dayLabel(day: string, locale: string): string {
    return formatDate(`${day}T00:00:00Z`, locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// How many day slots the period spans, at least the days already gone.
export function periodDayCount(usage: Pick<CreditUsage, 'period' | 'days'>): number {
    const firstDay = new Date(`${usage.period.start.slice(0, 10)}T00:00:00Z`).getTime()
    return Math.max(Math.ceil((new Date(usage.period.end).getTime() - firstDay) / DAY_MS), usage.days.length, 1)
}
