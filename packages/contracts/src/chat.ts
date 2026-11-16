import { z } from 'zod'
import { providerSchema, thinkingLevelSchema } from './agent.js'
import { sessionSourceSchema } from './session.js'
import { foremanBriefSchema } from './foreman.js'
import { runGoalSchema } from './run-goal.js'

export const messageAuthorSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80).optional(),
})
export type MessageAuthor = z.infer<typeof messageAuthorSchema>

export const chatRequestSchema = z.object({
    sessionId: z.string().optional(),
    message: z.string().min(1),
    connectionId: z.string().optional(),
    provider: providerSchema.optional(),
    model: z.string().optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
    source: sessionSourceSchema.optional(),
    foreman: foremanBriefSchema.optional(),
    author: messageAuthorSchema.optional(),
    callableAgentIds: z.array(z.string().min(1).max(64)).max(5000).optional(),
    install: z.boolean().optional(),
    userLanguage: z.string().optional(),
    goal: runGoalSchema.optional(),
})

export const contextOccupancySchema = z.object({
    usedTokens: z.number(),
    maxTokens: z.number(),
})
export type ContextOccupancy = z.infer<typeof contextOccupancySchema>

export const usageSchema = z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
    context: contextOccupancySchema.optional(),
})
export type Usage = z.infer<typeof usageSchema>

export const messageUsageMetadataSchema = z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: usageSchema.optional(),
})
export type MessageUsageMetadata = z.infer<typeof messageUsageMetadataSchema>

export const runResultSchema = z.object({
    sessionId: z.string(),
    text: z.string(),
    usage: usageSchema.optional(),
})
export type RunResult = z.infer<typeof runResultSchema>
