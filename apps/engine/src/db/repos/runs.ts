import { and, desc, eq, getTableColumns, gte, sql } from 'drizzle-orm'
import type { ContextOccupancy, RunStarter } from '@rerun/contracts'
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

export type RunFilter = { limit?: number; sessionId?: string; status?: string; triggerSlug?: string }

// A list never carries what a script printed: that is read one run at a time, with `getRun`.
export type ListedRun = Omit<RunRow, 'scriptOutput'>

export async function listRunsByAgent(agentId: string, { limit = 50, sessionId, status, triggerSlug }: RunFilter = {}): Promise<ListedRun[]> {
    const { db } = await getSystemDb(agentId)
    const conditions = [eq(runs.agentId, agentId)]
    if (sessionId) conditions.push(eq(runs.sessionId, sessionId))
    if (status) conditions.push(eq(runs.status, status))
    if (triggerSlug) conditions.push(eq(runs.triggerSlug, triggerSlug))
    const { scriptOutput: _output, ...listed } = getTableColumns(runs)
    return db
        .select(listed)
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
        checkinJson: null,
        costMicros: null,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        starterKind: null,
        starterId: null,
        startedAt: nowIso(),
        finishedAt: null,
        error: null,
        exitCode: null,
        scriptOutput: null,
    }
    const { db } = await getSystemDb(agentId)
    await db.insert(runs).values(row)
    return row
}

// A script routine's run has no conversation: its session stays empty, and the routine it belongs to
// is read from its trigger, like any scheduled run.
export const SCRIPT_RUN_SESSION_ID = ''

export async function startScriptRun(agentId: string, slug: string, id: string = newId()): Promise<RunRow> {
    const row = await startRun(agentId, SCRIPT_RUN_SESSION_ID, id)
    const { db } = await getSystemDb(agentId)
    const scheduled = { triggerSource: 'schedule', triggerSlug: slug, starterKind: 'schedule', starterId: slug } as const
    await db.update(runs).set(scheduled).where(eq(runs.id, row.id))
    return { ...row, ...scheduled }
}

export type ScriptRunResult = { status: 'done' | 'error' | 'cancelled'; exitCode: number | null; output: string; error: string | null }

// Written whatever the row says, so a job on a computer that ends after the engine restarted, or
// after its run was cancelled, leaves what really happened.
export async function settleScriptRun(agentId: string, id: string, result: ScriptRunResult): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ status: result.status, finishedAt: nowIso(), exitCode: result.exitCode, scriptOutput: result.output, error: result.error }).where(eq(runs.id, id))
}

export type RunContextPatch = { provider: string; model: string; triggerSource: string; triggerSlug: string | null }

export async function setRunContext(agentId: string, id: string, patch: RunContextPatch): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set(patch).where(eq(runs.id, id))
}

export async function setRunStarter(agentId: string, id: string, starter: RunStarter): Promise<void> {
    const { db } = await getSystemDb(agentId)
    await db.update(runs).set({ starterKind: starter.kind, starterId: starter.id }).where(eq(runs.id, id))
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

export type InterruptedRun = { id: string; sessionId: string; triggerSource: string | null; triggerSlug: string | null; checkinJson: string | null; startedAt: string }

// Returns the rows it repaired rather than a count: a run interrupted mid-flight also left a
// conversation stuck on the hub, and only these ids can tell it the run is over.
// `keepOpenScriptJobs`: a script whose job is still out on a linked computer was not interrupted by
// the restart. Its run stays running, for `resumeScriptJobs` to take up again.
export async function failInterruptedRuns(agentId: string, { keepOpenScriptJobs = false }: { keepOpenScriptJobs?: boolean } = {}): Promise<InterruptedRun[]> {
    const { db } = await getSystemDb(agentId)
    const running = eq(runs.status, 'running')
    const interrupted = keepOpenScriptJobs ? and(running, sql`${runs.id} NOT IN (SELECT run_id FROM remote_jobs WHERE run_id IS NOT NULL AND ended_at IS NULL)`) : running
    const stale = await db
        .select({ id: runs.id, sessionId: runs.sessionId, triggerSource: runs.triggerSource, triggerSlug: runs.triggerSlug, checkinJson: runs.checkinJson, startedAt: runs.startedAt })
        .from(runs)
        .where(interrupted)
    if (stale.length === 0) return []
    await db.update(runs).set({ status: 'error', finishedAt: nowIso(), error: 'interrupted: engine restarted' }).where(interrupted)
    return stale
}
