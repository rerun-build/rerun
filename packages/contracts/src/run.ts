import { z } from 'zod'

export const runStatusSchema = z.enum(['running', 'done', 'error', 'cancelled'])

export const runSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    sessionId: z.string(),
    status: runStatusSchema,
    stepCount: z.number(),
    usageJson: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    triggerSource: z.string().nullable(),
    triggerSlug: z.string().nullable(),
    costMicros: z.number().nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    cachedInputTokens: z.number().nullable(),
    reasoningTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    error: z.string().nullable(),
    // Set on a run of a script routine once it ended with a code; absent on an engine without them.
    exitCode: z.number().int().nullable().optional(),
})
export type Run = z.infer<typeof runSchema>

export const runsListSchema = z.object({ runs: z.array(runSchema) })

export const runDetailSchema = runSchema.extend({ output: z.string().nullable().optional() })
export type RunDetail = z.infer<typeof runDetailSchema>

// The `finishReason` of the row a compaction's summary call leaves among a run's steps. It carries
// the number of the step it follows, 0 before the turn, and no tool call of its own.
export const COMPACTION_FINISH_REASON = 'compaction'

export const runStepSchema = z.object({
    id: z.string(),
    runId: z.string(),
    agentId: z.string(),
    sessionId: z.string(),
    stepNumber: z.number(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    finishReason: z.string().nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    cachedInputTokens: z.number().nullable(),
    reasoningTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    // Absent on an engine that predates the `step-cache-cost` migration (system.db v3).
    cacheWriteTokens: z.number().nullable().optional(),
    costMicros: z.number().nullable().optional(),
    toolCallCount: z.number(),
    textLength: z.number(),
    durationMs: z.number().nullable(),
    createdAt: z.string(),
})
export type RunStep = z.infer<typeof runStepSchema>

export const runStepsListSchema = z.object({ steps: z.array(runStepSchema) })
export type RunStepsList = z.infer<typeof runStepsListSchema>

export const toolCallSchema = z.object({
    id: z.string(),
    runId: z.string(),
    agentId: z.string(),
    sessionId: z.string(),
    stepNumber: z.number(),
    toolCallId: z.string().nullable(),
    toolName: z.string(),
    inputJson: z.string().nullable(),
    resultJson: z.string().nullable(),
    isError: z.number(),
    durationMs: z.number().nullable(),
    createdAt: z.string(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

export const toolCallsListSchema = z.object({ tools: z.array(toolCallSchema) })
export type ToolCallsList = z.infer<typeof toolCallsListSchema>
