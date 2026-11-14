import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { ContextOccupancy } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'
import { runs, type RunRow } from '../schema.js'
import { newId, nowIso } from '../../lib/ids.js'

export type UsageBucket = {
    day: string
    model: string | null
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    reasoningTokens: number
    totalTokens: number
    costMicros: number
    runCount: number
}

export async function aggregateUsageByDay(agentId: string, sinceIso: string | null): Promise<UsageBucket[]> {
    const { db } = await getSystemDb(agentId)
    const day = sql<string>`substr(${runs.startedAt}, 1, 10)`
    const conditions = [eq(runs.agentId, agentId), eq(runs.status, 'done')]
    if (sinceIso) conditions.push(gte(runs.startedAt, sinceIso))
    return db
        .select({
            day,
            model: runs.model,
            inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)`,
            outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)`,
            cachedInputTokens: sql<number>`coalesce(sum(${runs.cachedInputTokens}), 0)`,
            reasoningTokens: sql<number>`coalesce(sum(${runs.reasoningTokens}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${runs.totalTokens}), 0)`,
            costMicros: sql<number>`coalesce(sum(${runs.costMicros}), 0)`,
            runCount: sql<number>`count(*)`,
        })
        .from(runs)
        .where(and(...conditions))
        .groupBy(day, runs.model)
        .orderBy(day)
}

export async function getRun(agentId: string, id: string): Promise<RunRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1)
    return rows[0]
}

export type RunFilter = { limit?: number; sessionId?: string; status?: string }

export async function listRunsByAgent(agentId: string, { limit = 50, sessionId, status }: RunFilter = {}): Promise<RunRow[]> {
    const { db } = await getSystemDb(agentId)
    const conditions = [eq(runs.agentId, agentId)]
    if (sessionId) conditions.push(eq(runs.sessionId, sessionId))
    if (status) conditions.push(eq(runs.status, status))
    return db
        .select()
        .from(runs)
        .where(and(...conditions))
        .orderBy(desc(runs.startedAt))
        .limit(limit)
}

export async function startRun(agentId: string, sessionId: string, id: string = newId()): Promise<RunRow> {
    const row: RunRow = {
        id,
        agentId,
        sessionId,
        status: 'running',
        stepCount: 0,
        usageJson: null,
        provider: null,
        model: null,
        triggerSource: null,
        triggerSlug: null,
        costMicros: null,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        startedAt: nowIso(),
        finishedAt: null,
        error: null,
    }
    const { db } = await getSystemDb(agentId)
    await db.insert(runs).values(row)
    return row
}

export type RunContextPatch = { provider: string; model: string; triggerSource: string; triggerSlug: string | null }

export async function setRunContext(agentId: string, id: string, patch: RunContextPatch): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set(patch).where(eq(runs.id, id))
}

export async function bumpRunStep(agentId: string, id: string, stepCount: number): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ stepCount }).where(eq(runs.id, id))
}

type UsageTokens = { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number }

export async function finishRun(agentId: string, id: string, usage: UsageTokens | null | undefined, stepCount: number, costMicros: number | null = null, context?: ContextOccupancy): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({
        status: 'done',
        finishedAt: nowIso(),
        usageJson: JSON.stringify(context ? { ...usage, context } : (usage ?? null)),
        stepCount,
        costMicros,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
    }).where(eq(runs.id, id))
}

export async function failRun(agentId: string, id: string, error: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ status: 'error', finishedAt: nowIso(), error }).where(eq(runs.id, id))
}

export async function cancelRun(agentId: string, id: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ status: 'cancelled', finishedAt: nowIso() }).where(eq(runs.id, id))
}

export type InterruptedRun = { id: string; sessionId: string; triggerSource: string | null; triggerSlug: string | null; startedAt: string }

export async function failInterruptedRuns(agentId: string): Promise<InterruptedRun[]> {
    const { db } = await getSystemDb(agentId)
    const stale = await db
        .select({ id: runs.id, sessionId: runs.sessionId, triggerSource: runs.triggerSource, triggerSlug: runs.triggerSlug, startedAt: runs.startedAt })
        .from(runs)
        .where(eq(runs.status, 'running'))
    if (stale.length === 0) return []
    await db.update(runs).set({ status: 'error', finishedAt: nowIso(), error: 'interrupted: engine restarted' }).where(eq(runs.status, 'running'))
    return stale
}
