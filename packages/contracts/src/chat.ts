import { z } from 'zod'
import { providerSchema } from './agent.js'
import { sessionSourceSchema } from './session.js'
import { foremanBriefSchema } from './foreman.js'

// The engine has no notion of users: the hub names who typed a message and the engine keeps it as is.
// `timezone` is the IANA zone of the device they wrote from, what the Chief of Staff reads the hour
// of their day in. An engine that predates it drops it.
export const messageAuthorSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80).optional(),
    timezone: z.string().min(1).max(64).optional(),
})

// How an app with no cookie (the mobile app) tells the hub the time zone of the device.
export const TIME_ZONE_HEADER = 'x-rerun-time-zone'

// An IANA zone as the browser or the app sent it, or nothing: a zone Intl cannot read is dropped.
export function validTimeZone(value: string | null | undefined): string | undefined {
    if (!value) return undefined
    try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return value
    } catch {
        return undefined
    }
}
export type MessageAuthor = z.infer<typeof messageAuthorSchema>

export const chatRequestSchema = z.object({
    sessionId: z.string().optional(),
    message: z.string().min(1),
    connectionId: z.string().optional(),
    provider: providerSchema.optional(),
    model: z.string().optional(),
    source: sessionSourceSchema.optional(),
    // Read only when the target is the foreman; any other agent ignores it.
    foreman: foremanBriefSchema.optional(),
    author: messageAuthorSchema.optional(),
    // The engine ids of the coworkers the author reaches. Sent for a member kept out of some Box: the
    // engine knows no Box, so `call_agent` would otherwise offer them every coworker on the machine.
    // Absent, every coworker can be called.
    callableAgentIds: z.array(z.string().min(1).max(64)).max(5000).optional(),
    // The message starts the agent's guided setup. Only read on a new conversation: the engine
    // answers 409 `install_in_flight` with the conversation already running it, if there is one.
    install: z.boolean().optional(),
    // The language the user reads the app in, sent with an install: its guide is the publisher's
    // words, so the coworker has nothing the user wrote to tell it from.
    userLanguage: z.string().optional(),
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
