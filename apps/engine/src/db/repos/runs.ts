import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import type { ContextOccupancy } from '@moldwright/contracts'
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

export type RunFilter = { limit?: number; sessionId?: string; status?: string; job?: string; branch?: string }

export async function listRunsByAgent(agentId: string, { limit = 50, sessionId, status, job, branch }: RunFilter = {}): Promise<RunRow[]> {
    const { db } = await getSystemDb(agentId)
    const conditions = [eq(runs.agentId, agentId)]
    if (sessionId) conditions.push(eq(runs.sessionId, sessionId))
    if (status) conditions.push(eq(runs.status, status))
    if (job) conditions.push(eq(runs.jobRef, job))
    if (branch) conditions.push(eq(runs.branch, branch))
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
        initiatorAgentId: null,
        initiatorRunId: null,
        initiatorSessionId: null,
        initiatorUserId: null,
        jobRef: null,
        branch: null,
        copyIndex: null,
        goalJson: null,
        goalState: null,
        goalTurns: null,
        goalVerdictsJson: null,
        compactions: null,
        compactSummaryChars: null,
        compactAtTokens: null,
        handoverPath: null,
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

export type RunLineagePatch = Partial<Pick<RunRow, 'initiatorAgentId' | 'initiatorRunId' | 'initiatorSessionId' | 'initiatorUserId' | 'jobRef' | 'branch' | 'copyIndex'>>

export async function setRunLineage(agentId: string, id: string, patch: RunLineagePatch): Promise<void> {
    if (Object.keys(patch).length === 0) return
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set(patch).where(eq(runs.id, id))
}

export async function setRunGoal(agentId: string, id: string, goalJson: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db
        .update(runs)
        .set({ goalJson, goalState: 'running', goalTurns: 0, goalVerdictsJson: '[]' })
        .where(and(eq(runs.id, id), isNull(runs.goalJson)))
}

export async function setRunCompactAt(agentId: string, id: string, compactAtTokens: number): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ compactAtTokens }).where(eq(runs.id, id))
}

export async function recordRunCompaction(agentId: string, id: string, summaryChars: number): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db
        .update(runs)
        .set({ compactions: sql`coalesce(${runs.compactions}, 0) + 1`, compactSummaryChars: sql`coalesce(${runs.compactSummaryChars}, 0) + ${summaryChars}` })
        .where(eq(runs.id, id))
}

export async function setRunHandover(agentId: string, id: string, handoverPath: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ handoverPath }).where(eq(runs.id, id))
}

export type GoalVerdict = { turn: number; met: boolean; reason: string }

export async function recordGoalVerdict(agentId: string, id: string, verdict: GoalVerdict): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db
        .update(runs)
        .set({
            goalVerdictsJson: sql`json_insert(coalesce(${runs.goalVerdictsJson}, '[]'), '$[#]', json(${JSON.stringify(verdict)}))`,
            goalTurns: sql`coalesce(${runs.goalTurns}, 0) + 1`,
        })
        .where(and(eq(runs.id, id), eq(runs.goalState, 'running')))
}

const goalUnchecked = sql`CASE WHEN ${runs.goalState} = 'running' THEN 'unchecked' ELSE ${runs.goalState} END`

export async function bumpRunStep(agentId: string, id: string, stepCount: number): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ stepCount }).where(eq(runs.id, id))
}

export type RunLivePatch = { stepCount: number; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number } }

export async function updateRunLive(agentId: string, id: string, { stepCount, usage }: RunLivePatch): Promise<void> {
    const { db } = await getSystemDb(agentId)
    const set: Partial<RunRow> = { stepCount }
    if (usage?.inputTokens !== undefined) set.inputTokens = usage.inputTokens
    if (usage?.outputTokens !== undefined) set.outputTokens = usage.outputTokens
    if (usage?.totalTokens !== undefined) set.totalTokens = usage.totalTokens
    if (usage?.reasoningTokens !== undefined) set.reasoningTokens = usage.reasoningTokens
    if (usage?.cachedInputTokens !== undefined) set.cachedInputTokens = usage.cachedInputTokens
    await db.update(runs).set(set).where(and(eq(runs.id, id), eq(runs.status, 'running')))
}

type UsageTokens = { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number }

export async function finishRun(agentId: string, id: string, usage: UsageTokens | null | undefined, stepCount: number, costMicros: number | null = null, context?: ContextOccupancy, goalState?: 'met' | 'not_met'): Promise<void> {
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
        ...(goalState ? { goalState } : {}),
    }).where(eq(runs.id, id))
}

export async function failRun(agentId: string, id: string, error: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ status: 'error', finishedAt: nowIso(), error, goalState: goalUnchecked }).where(eq(runs.id, id))
}

export async function cancelRun(agentId: string, id: string): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ status: 'cancelled', finishedAt: nowIso(), goalState: goalUnchecked }).where(eq(runs.id, id))
}

export type InterruptedRun = { id: string; sessionId: string; triggerSource: string | null; triggerSlug: string | null; startedAt: string }

export async function failInterruptedRuns(agentId: string): Promise<InterruptedRun[]> {
    const { db } = await getSystemDb(agentId)
    const stale = await db
        .select({ id: runs.id, sessionId: runs.sessionId, triggerSource: runs.triggerSource, triggerSlug: runs.triggerSlug, startedAt: runs.startedAt })
        .from(runs)
        .where(eq(runs.status, 'running'))
    if (stale.length === 0) return []
    await db.update(runs).set({ status: 'error', finishedAt: nowIso(), error: 'interrupted: engine restarted', goalState: goalUnchecked }).where(eq(runs.status, 'running'))
    return stale
}
