import { z } from 'zod'

export const REWIND_HOURS_PER_WEEK = 168

const countByName = z.object({ name: z.string(), count: z.number() })

export const rewindAgentReportQuerySchema = z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
})

export const rewindRunOutputSchema = z.object({
    runId: z.string(),
    startedAt: z.string(),
    source: z.string(),
    title: z.string(),
    text: z.string(),
})
export type RewindRunOutput = z.infer<typeof rewindRunOutputSchema>

export const rewindAgentReportSchema = z.object({
    from: z.string(),
    to: z.string(),
    runs: z.object({ total: z.number(), done: z.number(), error: z.number(), cancelled: z.number() }),
    workedMs: z.number(),
    hourly: z.array(z.number()).length(REWIND_HOURS_PER_WEEK),
    bySource: z.array(countByName),
    models: z.array(countByName),
    tokens: z.number(),
    costMicros: z.number().nullable(),
    longestRun: z.object({ runId: z.string(), durationMs: z.number(), startedAt: z.string(), title: z.string() }).nullable(),
    tools: z.object({ total: z.number(), errors: z.number(), top: z.array(countByName) }),
    connectors: z.array(countByName),
    calledBy: z.array(z.object({ agentId: z.string(), count: z.number() })),
    sessions: z.number(),
    memories: z.object({
        created: z.number(),
        topRecalled: z.object({ content: z.string(), accessCount: z.number() }).nullable(),
    }),
    outputs: z.array(rewindRunOutputSchema),
})
export type RewindAgentReport = z.infer<typeof rewindAgentReportSchema>

export const rewindAwardIdSchema = z.enum(['night-owl', 'marathon', 'flawless', 'toolsmith', 'connector-hub', 'team-player'])
export type RewindAwardId = z.infer<typeof rewindAwardIdSchema>

export const rewindAgentSummarySchema = z.object({
    agentId: z.string(),
    name: z.string(),
    spaceName: z.string().nullable(),
    runs: z.number(),
    errors: z.number(),
    workedMs: z.number(),
    topTools: z.array(z.string()),
    connectors: z.array(z.string()),
})

export const rewindHighlightSchema = z.object({
    agentId: z.string(),
    headline: z.string(),
    detail: z.string(),
})
export type RewindHighlight = z.infer<typeof rewindHighlightSchema>

export const rewindPayloadSchema = z.object({
    version: z.literal(1),
    weekStart: z.string(),
    weekEnd: z.string(),
    totals: z.object({
        runs: z.number(),
        done: z.number(),
        errors: z.number(),
        workedMs: z.number(),
        tokens: z.number(),
        costMicros: z.number().nullable(),
        toolCalls: z.number(),
        sessions: z.number(),
        memoriesCreated: z.number(),
        activeAgents: z.number(),
        unreachableAgents: z.number(),
    }),
    previous: z.object({ runs: z.number(), workedMs: z.number() }).nullable(),
    hourly: z.array(z.number()).length(REWIND_HOURS_PER_WEEK),
    agents: z.array(rewindAgentSummarySchema),
    mvpAgentId: z.string().nullable(),
    connectors: z.array(z.object({ slug: z.string(), name: z.string(), icon: z.string().nullable(), calls: z.number(), agents: z.number() })),
    topTools: z.array(countByName),
    collaborations: z.array(z.object({ fromAgentId: z.string(), toAgentId: z.string(), count: z.number() })),
    longestRun: z.object({ agentId: z.string(), durationMs: z.number(), title: z.string() }).nullable(),
    topMemory: z.object({ agentId: z.string(), content: z.string(), accessCount: z.number() }).nullable(),
    highlights: z.array(rewindHighlightSchema),
    awards: z.array(z.object({ id: rewindAwardIdSchema, agentId: z.string(), value: z.number() })),
})
export type RewindPayload = z.infer<typeof rewindPayloadSchema>
