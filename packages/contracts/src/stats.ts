import { z } from 'zod'

export const statsDatasetSchema = z.enum(['runs', 'runSteps', 'toolCalls', 'sessions'])
export type StatsDataset = z.infer<typeof statsDatasetSchema>

export const statsMetricSchema = z.enum([
    'count',
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'reasoningTokens',
    'cost',
    'avgDurationMs',
    'errorCount',
    'errorRate',
])
export type StatsMetric = z.infer<typeof statsMetricSchema>

export const statsGroupBySchema = z.enum(['none', 'model', 'status', 'triggerSource', 'finishReason', 'stepNumber', 'toolName', 'source'])
export type StatsGroupBy = z.infer<typeof statsGroupBySchema>

export const statsTimeRangeSchema = z.enum(['24h', '7d', '30d', '90d', 'all'])
export type StatsTimeRange = z.infer<typeof statsTimeRangeSchema>

export const statsRunStatusFilterSchema = z.enum(['all', 'done', 'error', 'cancelled', 'running'])
export type StatsRunStatusFilter = z.infer<typeof statsRunStatusFilterSchema>

// Fenêtre de l'agrégat d'usage (`/agents/:id/usage`), plus courte que celle des stats: pas de 90d.
export const usageTimeRangeSchema = z.enum(['24h', '7d', '30d', 'all'])
export type UsageTimeRange = z.infer<typeof usageTimeRangeSchema>

export const statsChartTypeSchema = z.enum(['area', 'bar', 'line', 'donut', 'stat'])
export type StatsChartType = z.infer<typeof statsChartTypeSchema>

export const statsQuerySchema = z.object({
    dataset: statsDatasetSchema,
    metric: statsMetricSchema,
    groupBy: statsGroupBySchema.default('none'),
    range: statsTimeRangeSchema.default('7d'),
    status: statsRunStatusFilterSchema.optional(),
})
export type StatsQuery = z.infer<typeof statsQuerySchema>

export const statsPointSchema = z.object({
    bucket: z.string(),
    group: z.string().nullable(),
    value: z.number(),
    count: z.number(),
})
export type StatsPoint = z.infer<typeof statsPointSchema>

export const statsResponseSchema = z.object({ points: z.array(statsPointSchema) })

export type StatsUnit = 'count' | 'tokens' | 'costMicros' | 'ms' | 'ratio'
export type StatsAgg = 'sum' | 'avg'

export const STATS_METRIC_META: Record<StatsMetric, { unit: StatsUnit; agg: StatsAgg }> = {
    count: { unit: 'count', agg: 'sum' },
    totalTokens: { unit: 'tokens', agg: 'sum' },
    inputTokens: { unit: 'tokens', agg: 'sum' },
    outputTokens: { unit: 'tokens', agg: 'sum' },
    cachedInputTokens: { unit: 'tokens', agg: 'sum' },
    reasoningTokens: { unit: 'tokens', agg: 'sum' },
    cost: { unit: 'costMicros', agg: 'sum' },
    avgDurationMs: { unit: 'ms', agg: 'avg' },
    errorCount: { unit: 'count', agg: 'sum' },
    errorRate: { unit: 'ratio', agg: 'avg' },
}

export const STATS_DATASETS: Record<
    StatsDataset,
    {
        metrics: StatsMetric[]
        groupBys: Exclude<StatsGroupBy, 'none'>[]
        supportsStatusFilter: boolean
    }
> = {
    runs: {
        metrics: ['count', 'totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'cost', 'avgDurationMs', 'errorCount', 'errorRate'],
        groupBys: ['model', 'status', 'triggerSource'],
        supportsStatusFilter: true,
    },
    runSteps: {
        metrics: ['count', 'totalTokens', 'inputTokens', 'outputTokens', 'avgDurationMs'],
        groupBys: ['model', 'finishReason', 'stepNumber'],
        supportsStatusFilter: false,
    },
    toolCalls: {
        metrics: ['count', 'errorCount', 'errorRate', 'avgDurationMs'],
        groupBys: ['toolName'],
        supportsStatusFilter: false,
    },
    sessions: {
        metrics: ['count'],
        groupBys: ['source', 'status'],
        supportsStatusFilter: false,
    },
}

export function isValidStatsCombo(dataset: StatsDataset, metric: StatsMetric, groupBy: StatsGroupBy): boolean {
    const def = STATS_DATASETS[dataset]
    return def.metrics.includes(metric) && (groupBy === 'none' || def.groupBys.includes(groupBy))
}
