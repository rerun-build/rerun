import { and, asc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { visibleText, type StatsDataset, type StatsGroupBy, type StatsMetric, type StatsPoint, type StatsRunStatusFilter } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'
import { runs, runSteps, sessions, toolCalls } from '../schema.js'

type DatasetDef = {
    table: SQLiteTable
    agentId: SQLiteColumn
    timeColumn: SQLiteColumn
    metrics: Partial<Record<StatsMetric, SQL<number>>>
    groups: Partial<Record<StatsGroupBy, SQL<string | null>>>
    extraConditions?: Partial<Record<StatsMetric, SQL>>
}

const runsDurationMs = sql<number>`coalesce(avg((julianday(${runs.finishedAt}) - julianday(${runs.startedAt})) * 86400000.0), 0)`

const DATASETS: Record<StatsDataset, DatasetDef> = {
    runs: {
        table: runs,
        agentId: runs.agentId,
        timeColumn: runs.startedAt,
        metrics: {
            count: sql<number>`count(*)`,
            totalTokens: sql<number>`coalesce(sum(${runs.totalTokens}), 0)`,
            inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)`,
            outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)`,
            cachedInputTokens: sql<number>`coalesce(sum(${runs.cachedInputTokens}), 0)`,
            reasoningTokens: sql<number>`coalesce(sum(${runs.reasoningTokens}), 0)`,
            cost: sql<number>`coalesce(sum(${runs.costMicros}), 0)`,
            avgDurationMs: runsDurationMs,
            errorCount: sql<number>`coalesce(sum(case when ${runs.status} = 'error' then 1 else 0 end), 0)`,
            errorRate: sql<number>`coalesce(avg(case when ${runs.status} = 'error' then 1.0 else 0.0 end), 0)`,
        },
        groups: {
            model: sql<string | null>`${runs.model}`,
            status: sql<string | null>`${runs.status}`,
            triggerSource: sql<string | null>`${runs.triggerSource}`,
        },
        extraConditions: {
            avgDurationMs: isNotNull(runs.finishedAt),
        },
    },
    runSteps: {
        table: runSteps,
        agentId: runSteps.agentId,
        timeColumn: runSteps.createdAt,
        metrics: {
            count: sql<number>`count(*)`,
            totalTokens: sql<number>`coalesce(sum(${runSteps.totalTokens}), 0)`,
            inputTokens: sql<number>`coalesce(sum(${runSteps.inputTokens}), 0)`,
            outputTokens: sql<number>`coalesce(sum(${runSteps.outputTokens}), 0)`,
            avgDurationMs: sql<number>`coalesce(avg(${runSteps.durationMs}), 0)`,
        },
        groups: {
            model: sql<string | null>`${runSteps.model}`,
            finishReason: sql<string | null>`${runSteps.finishReason}`,
            stepNumber: sql<string | null>`cast(${runSteps.stepNumber} as text)`,
        },
    },
    toolCalls: {
        table: toolCalls,
        agentId: toolCalls.agentId,
        timeColumn: toolCalls.createdAt,
        metrics: {
            count: sql<number>`count(*)`,
            errorCount: sql<number>`coalesce(sum(${toolCalls.isError}), 0)`,
            errorRate: sql<number>`coalesce(avg(${toolCalls.isError} * 1.0), 0)`,
            avgDurationMs: sql<number>`coalesce(avg(${toolCalls.durationMs}), 0)`,
        },
        groups: {
            toolName: sql<string | null>`${toolCalls.toolName}`,
        },
    },
    sessions: {
        table: sessions,
        agentId: sessions.agentId,
        timeColumn: sessions.createdAt,
        metrics: {
            count: sql<number>`count(*)`,
        },
        groups: {
            source: sql<string | null>`${sessions.source}`,
            status: sql<string | null>`${sessions.status}`,
        },
    },
}

export type StatsRepoQuery = {
    dataset: StatsDataset
    metric: StatsMetric
    groupBy: StatsGroupBy
    sinceIso: string | null
    bucket: 'hour' | 'day'
    status?: StatsRunStatusFilter
}

const FAILURE_METRICS: StatsMetric[] = ['failureCount', 'failureRate']
const STOP_PREFIXES = ['BLOCKED:', 'ESCALATE:']

const runStopped = sql<number>`case when ${runs.status} in ('error', 'cancelled') or (${runs.goalJson} is not null and ${runs.status} <> 'running' and ${runs.goalState} is not 'met') then 1 else 0 end`

const runFinalContent = sql<string | null>`case when ${runs.status} = 'done' then (select m.content_json from messages m where m.session_id = runs.session_id and m.role = 'assistant' and m.created_at >= runs.started_at and m.created_at <= runs.finished_at order by m.created_at desc, m.rowid desc limit 1) end`

function endsOnStopLine(content: string): boolean {
    const lines = visibleText(JSON.parse(content), '\n').split('\n').map(line => line.trim()).filter(Boolean)
    if (lines.at(-1)?.startsWith('Tools:')) lines.pop()
    const last = lines.at(-1) ?? ''
    return STOP_PREFIXES.some(prefix => last.startsWith(prefix))
}

type RunFailureRow = { bucket: string; group: string | null; stopped: number; finalContent: string | null }

function foldFailures(rows: RunFailureRow[], asRate: boolean): StatsPoint[] {
    const points = new Map<string, StatsPoint>()
    for (const row of rows) {
        const key = JSON.stringify([row.bucket, row.group])
        const point = points.get(key) ?? { bucket: row.bucket, group: row.group, value: 0, count: 0 }
        point.count += 1
        if (Number(row.stopped) === 1 || (row.finalContent !== null && endsOnStopLine(row.finalContent))) point.value += 1
        points.set(key, point)
    }
    return [...points.values()].map(point => (asRate ? { ...point, value: point.value / point.count } : point))
}

export async function aggregateStats(agentId: string, query: StatsRepoQuery): Promise<StatsPoint[]> {
    const def = DATASETS[query.dataset]
    const metricSql = def.metrics[query.metric]
    const failure = query.dataset === 'runs' && FAILURE_METRICS.includes(query.metric)
    if (!metricSql && !failure) throw new Error(`unsupported metric ${query.metric} for dataset ${query.dataset}`)
    const groupSql = query.groupBy === 'none' ? null : def.groups[query.groupBy]
    if (query.groupBy !== 'none' && !groupSql) throw new Error(`unsupported groupBy ${query.groupBy} for dataset ${query.dataset}`)

    const bucket =
        query.bucket === 'hour'
            ? sql<string>`substr(${def.timeColumn}, 1, 13) || ':00'`
            : sql<string>`substr(${def.timeColumn}, 1, 10)`

    const conditions: SQL[] = [eq(def.agentId, agentId)]
    if (query.sinceIso) conditions.push(gte(def.timeColumn, query.sinceIso))
    if (query.dataset === 'runs' && query.status && query.status !== 'all') conditions.push(eq(runs.status, query.status))
    const extra = def.extraConditions?.[query.metric]
    if (extra) conditions.push(extra)

    const { db } = await getSystemDb(agentId)
    const group = groupSql ?? sql<string | null>`null`
    if (!metricSql) {
        const rows = await db.select({ bucket, group, stopped: runStopped, finalContent: runFinalContent }).from(runs).where(and(...conditions)).orderBy(asc(bucket))
        return foldFailures(rows, query.metric === 'failureRate')
    }
    const selection = {
        bucket,
        group,
        value: metricSql,
        count: sql<number>`count(*)`,
    }
    const base = db.select(selection).from(def.table).where(and(...conditions))
    const grouped = groupSql ? base.groupBy(bucket, groupSql) : base.groupBy(bucket)
    return grouped.orderBy(asc(bucket)).limit(5000)
}
