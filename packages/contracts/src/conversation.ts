import { z } from 'zod'

import { sessionSourceSchema } from './session.js'

export const sessionStatusSchema = z.enum(['idle', 'working', 'error', 'waiting_human', 'awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

// A conversation nobody can move forward without a human. Shared so the web's To handle list and
// the app's cannot drift apart. Wider than the `pending` badge of an agent row, which leaves out
// `error` because the row says "Error" on its own.
export const ATTENTION_STATUSES = ['error', 'waiting_human', 'awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'] as const satisfies readonly SessionStatus[]

const attentionStatuses: ReadonlySet<string> = new Set(ATTENTION_STATUSES)

export function needsHuman(status: SessionStatus): boolean {
    return attentionStatuses.has(status)
}

// The requests a coworker is stopped on, as opposed to the news it only leaves behind.
export const NEEDS_YOU_STATUSES = ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human'] as const satisfies readonly SessionStatus[]

const needsYouStatuses: ReadonlySet<string> = new Set(NEEDS_YOU_STATUSES)

// Takes any status: an inbox row also carries `done`, which no session has.
export function needsYou(status: string): boolean {
    return needsYouStatuses.has(status)
}

export const sessionOutcomeSchema = z.enum(['done', 'nothing', 'failed'])
export type SessionOutcome = z.infer<typeof sessionOutcomeSchema>

// A coworker has one `general` conversation; every other one is a `thread` of it, placed in General
// by the time it was opened.
export const sessionKindSchema = z.enum(['general', 'thread'])
export type SessionKind = z.infer<typeof sessionKindSchema>

export const conversationSchema = z.object({
    // Null for a conversation another agent opened on this one's engine: it has no hub row until
    // it is adopted, and cannot be opened before that.
    id: z.string().nullable(),
    agentId: z.string(),
    engineSessionId: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    source: sessionSourceSchema,
    updatedAt: z.string(),
    // Optional for a hub older than it: the app then names the coworker without drawing it.
    originAgentId: z.string().nullable().optional(),
    originAgentName: z.string().nullable(),
    // Optional for a hub older than them. `unseen`: a run finished after the caller last opened it.
    // `ask`: what the coworker waits on, for a status of `ATTENTION_STATUSES`.
    unseen: z.boolean().optional(),
    ask: z.string().nullable().optional(),
    // Optional for a hub older than them. Set on a scheduled or triggered run: `title` then says
    // what the run did, `automationName` names its routine and `outcome` how it ended.
    automationName: z.string().nullable().optional(),
    outcome: sessionOutcomeSchema.nullable().optional(),
    // Optional for a hub older than them. `kind` tells the coworker's General from its threads,
    // `createdAt` is where a thread sits in General.
    kind: sessionKindSchema.optional(),
    createdAt: z.string().optional(),
    // Optional for a hub older than it. What a thread opened with, when a person typed it; null
    // for a run the engine started.
    firstMessage: z.string().nullable().optional(),
    // Sent by the overview alone, optional for a hub older than it. The last thing said, as one line;
    // `mine` when the caller wrote it. Null in a conversation older than the hub's record of it.
    lastMessage: z.object({ text: z.string(), mine: z.boolean() }).nullable().optional(),
})
export type Conversation = z.infer<typeof conversationSchema>

// A conversation found by its title, for the search of the web's control center and of the app.
export const conversationHitSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    updatedAt: z.string(),
})
export type ConversationHit = z.infer<typeof conversationHitSchema>

// The longest title a person can give a conversation.
export const CONVERSATION_TITLE_MAX = 80

export const adoptConversationSchema = z.object({ engineSessionId: z.string().min(1), title: z.string() })

export const conversationAttachmentSchema = z.object({
    name: z.string(),
    // Workspace path on the agent's Box, the one the agent reads the file from.
    path: z.string(),
    mediaType: z.string(),
})
export type ConversationAttachment = z.infer<typeof conversationAttachmentSchema>

export const conversationMessageMetadataSchema = z.object({
    authorId: z.string().optional(),
    // When the engine stored the message. Optional so an app older than the hub keeps parsing.
    createdAt: z.string().optional(),
    attachments: z.array(conversationAttachmentSchema).optional(),
    // `peaks` is the base36 waveform of the marker (see voice.ts). Optional so an app older than
    // the hub keeps parsing: it falls back to a flat waveform.
    voice: z.object({ transcript: z.string(), src: z.string(), durationMs: z.number(), peaks: z.string().optional() }).optional(),
    // A message no one typed: the routine that fired the run, or the guided install it opens with.
    // The text carries the bare prompt or guide, so an app older than these fields shows a bubble.
    scheduledRun: z.object({ slug: z.string(), name: z.string() }).optional(),
    install: z.object({ agentName: z.string() }).optional(),
    // The Chief of Staff answered in the name of `authorId`. An app older than it shows the author's own bubble.
    relayedBy: z.literal('foreman').optional(),
})
export type ConversationMessageMetadata = z.infer<typeof conversationMessageMetadataSchema>

// Parts are AI SDK UI message parts. Only their `type` is checked here: the client narrows them
// with its own UIMessage generics, and the part union is the AI SDK's to evolve.
export const conversationMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    parts: z.array(z.looseObject({ type: z.string() })),
    metadata: conversationMessageMetadataSchema.optional(),
})
export type ConversationMessage = z.infer<typeof conversationMessageSchema>

// What one row of the Chats screen needs, so the app reads the whole workspace in one request
// instead of one per agent. `latest` is null for an agent nobody has talked to yet.
// `generalSessionId` is the coworker's General, the conversation a tap on its row opens: null before
// its first message, absent from a hub older than it.
export const agentConversationsOverviewSchema = z.array(
    z.object({
        agentId: z.string(),
        latest: conversationSchema.nullable(),
        pending: z.number(),
        generalSessionId: z.string().nullable().optional(),
    }),
)
export type AgentConversationsOverview = z.infer<typeof agentConversationsOverviewSchema>

// One row of the To handle list: a conversation waiting on its human, named by its agent so the
// client has nothing to resolve.
export const toHandleItemSchema = z.object({
    sessionId: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    title: z.string(),
    status: sessionStatusSchema,
    updatedAt: z.string(),
})
export type ToHandleItem = z.infer<typeof toHandleItemSchema>

// `total` is what the strip header and the tab badge count. `items` is a bounded page of it: a
// workspace can sit on thousands of untouched errors, and the list would otherwise run into
// PostgREST's silent 1000-row cap.
export const toHandleListSchema = z.object({
    items: z.array(toHandleItemSchema),
    total: z.number(),
})
export type ToHandleList = z.infer<typeof toHandleListSchema>

// An answer sent from outside the conversation, a push button above all. `toolCallId` names the card
// it answers, and the hub refuses it once that card is no longer the one waiting: a second tap, or an
// answer given meanwhile in the app. Without it, `reply` is a plain message in the conversation.
export const conversationReplySchema = z.discriminatedUnion('action', [
    z.object({ action: z.enum(['approve', 'deny']), toolCallId: z.string().min(1).max(256) }),
    z.object({ action: z.literal('reply'), toolCallId: z.string().min(1).max(256).optional(), text: z.string().trim().min(1).max(4000) }),
])
export type ConversationReply = z.infer<typeof conversationReplySchema>

export const conversationReplyResultSchema = z.object({ runId: z.string().nullable() })
export type ConversationReplyResult = z.infer<typeof conversationReplyResultSchema>

export const markHandledSchema = z.union([z.object({ sessionIds: z.array(z.string()).min(1) }), z.object({ all: z.literal(true) })])
export type MarkHandledInput = z.infer<typeof markHandledSchema>

export const inboxStatusSchema = z.enum(['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human', 'awaiting_ack', 'error', 'done'])
export type InboxStatus = z.infer<typeof inboxStatusSchema>

// One row of the web's inbox. A `done` row is one finished conversation, or every unseen run of one
// scheduled task: `sessionId` is the one to open, `sessionIds` every conversation it stands for.
export const inboxItemSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    sessionIds: z.array(z.string()),
    agentId: z.string(),
    agentName: z.string(),
    status: inboxStatusSchema,
    title: z.string(),
    // The question, approval, heads-up or error the agent left, when one was recorded.
    message: z.string().nullable(),
    updatedAt: z.string(),
    count: z.number(),
})
export type InboxItem = z.infer<typeof inboxItemSchema>

// `running` counts the conversations at work, the line the web shows above the list.
export const inboxSchema = z.object({
    items: z.array(inboxItemSchema),
    running: z.number(),
})
export type Inbox = z.infer<typeof inboxSchema>

// On a conversation's transcript: the time its session last changed when the transcript was read.
// Equal to the `updatedAt` of the conversation in a list read later, the transcript has not moved since.
export const TRANSCRIPT_UPDATED_AT_HEADER = 'x-conversation-updated-at'

export const activeRunSchema =z.object({ runId: z.string().nullable() })
