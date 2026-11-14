import { z } from 'zod'

import { sessionSourceSchema } from './session.js'

export const sessionStatusSchema = z.enum(['idle', 'working', 'error', 'waiting_human', 'awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const ATTENTION_STATUSES = ['error', 'waiting_human', 'awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'] as const satisfies readonly SessionStatus[]

const attentionStatuses: ReadonlySet<string> = new Set(ATTENTION_STATUSES)

export function needsHuman(status: SessionStatus): boolean {
    return attentionStatuses.has(status)
}

export const sessionOutcomeSchema = z.enum(['done', 'nothing', 'failed'])
export type SessionOutcome = z.infer<typeof sessionOutcomeSchema>

export const sessionKindSchema = z.enum(['general', 'thread'])
export type SessionKind = z.infer<typeof sessionKindSchema>

export const conversationSchema = z.object({
    id: z.string().nullable(),
    agentId: z.string(),
    engineSessionId: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    source: sessionSourceSchema,
    updatedAt: z.string(),
    originAgentId: z.string().nullable().optional(),
    originAgentName: z.string().nullable(),
    unseen: z.boolean().optional(),
    ask: z.string().nullable().optional(),
    automationName: z.string().nullable().optional(),
    outcome: sessionOutcomeSchema.nullable().optional(),
    kind: sessionKindSchema.optional(),
    createdAt: z.string().optional(),
    firstMessage: z.string().nullable().optional(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const conversationHitSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    updatedAt: z.string(),
})
export type ConversationHit = z.infer<typeof conversationHitSchema>

export const adoptConversationSchema = z.object({ engineSessionId: z.string().min(1), title: z.string() })

export const conversationAttachmentSchema = z.object({
    name: z.string(),
    path: z.string(),
    mediaType: z.string(),
})
export type ConversationAttachment = z.infer<typeof conversationAttachmentSchema>

export const conversationMessageMetadataSchema = z.object({
    authorId: z.string().optional(),
    createdAt: z.string().optional(),
    attachments: z.array(conversationAttachmentSchema).optional(),
    voice: z.object({ transcript: z.string(), src: z.string(), durationMs: z.number(), peaks: z.string().optional() }).optional(),
    scheduledRun: z.object({ slug: z.string(), name: z.string() }).optional(),
    install: z.object({ agentName: z.string() }).optional(),
})
export type ConversationMessageMetadata = z.infer<typeof conversationMessageMetadataSchema>

export const conversationMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    parts: z.array(z.looseObject({ type: z.string() })),
    metadata: conversationMessageMetadataSchema.optional(),
})
export type ConversationMessage = z.infer<typeof conversationMessageSchema>

export const agentConversationsOverviewSchema = z.array(
    z.object({
        agentId: z.string(),
        latest: conversationSchema.nullable(),
        pending: z.number(),
    }),
)
export type AgentConversationsOverview = z.infer<typeof agentConversationsOverviewSchema>

export const toHandleItemSchema = z.object({
    sessionId: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    updatedAt: z.string(),
})
export type ToHandleItem = z.infer<typeof toHandleItemSchema>

export const toHandleListSchema = z.object({
    items: z.array(toHandleItemSchema),
    total: z.number(),
})
export type ToHandleList = z.infer<typeof toHandleListSchema>

export const markHandledSchema = z.union([z.object({ sessionIds: z.array(z.string()).min(1) }), z.object({ all: z.literal(true) })])
export type MarkHandledInput = z.infer<typeof markHandledSchema>

export const inboxStatusSchema = z.enum(['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human', 'awaiting_ack', 'error', 'done'])
export type InboxStatus = z.infer<typeof inboxStatusSchema>

export const inboxItemSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    sessionIds: z.array(z.string()),
    agentId: z.string(),
    agentName: z.string(),
    status: inboxStatusSchema,
    title: z.string(),
    message: z.string().nullable(),
    updatedAt: z.string(),
    count: z.number(),
})
export type InboxItem = z.infer<typeof inboxItemSchema>

export const inboxSchema = z.object({
    items: z.array(inboxItemSchema),
    running: z.number(),
})
export type Inbox = z.infer<typeof inboxSchema>

export const activeRunSchema =z.object({ runId: z.string().nullable() })
