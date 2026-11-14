import { z } from 'zod'

export const sessionSourceSchema = z.enum(['dashboard', 'builder', 'schedule', 'agent', 'delegate', 'api', 'trigger'])
export type SessionSource = z.infer<typeof sessionSourceSchema>

export const sessionSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    title: z.string(),
    status: z.string(),
    source: sessionSourceSchema.default('dashboard'),
    originAgentId: z.string().nullable().default(null),
    originSessionId: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
})
export type Session = z.infer<typeof sessionSchema>

export const sessionsListSchema = z.object({ sessions: z.array(sessionSchema) })

export const messageRoleSchema = z.enum(['user', 'assistant', 'tool'])
export type MessageRole = z.infer<typeof messageRoleSchema>

export const messageSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    role: messageRoleSchema,
    contentJson: z.string(),
    toolCallsJson: z.string().nullable(),
    authorId: z.string().nullish(),
    createdAt: z.string(),
})
export type Message = z.infer<typeof messageSchema>

export const messagesListSchema = z.object({ messages: z.array(messageSchema) })
