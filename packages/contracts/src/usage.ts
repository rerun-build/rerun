import { z } from 'zod'
import { runStatusSchema } from './run.js'

// Who started a run. `api` is a chat that came in with no person behind it (the API, an MCP client,
// the hand-off of a setup); `checkin` is the Chief of Staff waking on its own; `job` is the end of a
// job on a linked computer.
export const RUN_STARTER_KINDS = ['person', 'coworker', 'schedule', 'webhook', 'checkin', 'job', 'api'] as const
export const runStarterKindSchema = z.enum(RUN_STARTER_KINDS)
export type RunStarterKind = z.infer<typeof runStarterKindSchema>

export type RunStarter = { kind: RunStarterKind; id: string | null }

// One run of any coworker of the machine, as the usage dashboard reads it. `costMicros` is null when
// the provider reported no price (a subscription, a direct API key, a custom endpoint): its tokens
// count, its cost is unknown, never 0. `starterKind` is null for a run from before the engine
// recorded who started it.
export const usageRunSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    status: runStatusSchema,
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costMicros: z.number().nullable(),
    starterKind: runStarterKindSchema.nullable(),
    starterId: z.string().nullable(),
    starterName: z.string().nullable(),
})
export type UsageRun = z.infer<typeof usageRunSchema>

export const USAGE_RUNS_LIMIT = 20_000

export const usageRunsResponseSchema = z.object({ runs: z.array(usageRunSchema), truncated: z.boolean() })
export type UsageRunsResponse = z.infer<typeof usageRunsResponseSchema>

// GET /usage/runs: the runs that started in [from, to], plus the ones still running. With `since`,
// only those that started or ended after it.
export const usageRunsQuerySchema = z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    since: z.string().datetime().optional(),
})
export type UsageRunsQuery = z.infer<typeof usageRunsQuerySchema>
