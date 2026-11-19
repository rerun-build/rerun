import { TRANSCRIPT_UPDATED_AT_HEADER, activeRunSchema, agentViewSchema, conversationMessageSchema, conversationSchema, messageFeedbackEntrySchema, skillProposalSchema, skillProposalsListSchema, type AgentView, type Conversation, type ConversationMessage, type MessageFeedbackCategory, type MessageFeedbackEntry, type MessageFeedbackRating, type MessageFeedbackScope, type SkillProposal, type SkillProposalDecision } from '@rerun/contracts'

import { api, apiConditional } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAgentView(caller: Caller, agentId: string): Promise<AgentView> {
    return agentViewSchema.parse(await api(`/api/v1/agents/${encodeURIComponent(agentId)}`, caller))
}

export async function fetchAgentConversations(caller: Caller, agentId: string): Promise<Conversation[]> {
    return conversationSchema.array().parse(await api(`/api/v1/agents/${encodeURIComponent(agentId)}/conversations`, caller))
}

// The transcript, unless it is still the one named `etag`: `messages` is then null. `updatedAt` is the
// version of the conversation it was read at, absent from a hub older than it.
export type TranscriptRead = { messages: ConversationMessage[] | null; etag: string | null; updatedAt: string | null }

export async function fetchMessages(caller: Caller, sessionId: string, etag: string | null = null): Promise<TranscriptRead> {
    const read = await apiConditional<unknown>(`/api/v1/conversations/${encodeURIComponent(sessionId)}/messages`, { ...caller, etag })
    return { messages: read.payload === null ? null : conversationMessageSchema.array().parse(read.payload), etag: read.etag, updatedAt: read.headers.get(TRANSCRIPT_UPDATED_AT_HEADER) }
}

export async function fetchActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    return activeRunSchema.parse(await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/active-run`, caller)).runId
}

export async function stopConversation(caller: Caller, sessionId: string): Promise<void> {
    await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/stop`, { ...caller, method: 'POST' })
}

// The notification the conversation waited on was read: it goes back to idle.
export async function acknowledgeAlert(caller: Caller, sessionId: string): Promise<void> {
    await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/acknowledge`, { ...caller, method: 'POST' })
}

export async function fetchSkillProposals(caller: Caller, sessionId: string): Promise<SkillProposal[]> {
    return skillProposalsListSchema.parse(await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/skill-proposals`, caller)).proposals
}

export async function decideSkillProposal(caller: Caller, sessionId: string, proposalId: string, decision: SkillProposalDecision): Promise<SkillProposal> {
    const { proposal } = await api<{ proposal: unknown }>(`/api/v1/conversations/${encodeURIComponent(sessionId)}/skill-proposals`, { ...caller, method: 'POST', body: { proposalId, decision } })
    return skillProposalSchema.parse(proposal)
}

// The chat's Undo on a Brain change. A 409 means the page changed again since.
export async function revertBrainPage(caller: Caller, slug: string, revisionId: string, expectedHash?: string): Promise<void> {
    await api(`/api/v1/brain/pages/${encodeURIComponent(slug)}/revert`, { ...caller, method: 'POST', body: { revisionId, expectedHash } })
}

export async function cancelSubRun(caller: Caller, agentId: string, runId: string, taskId: string): Promise<void> {
    await api(`/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/cancel`, { ...caller, method: 'POST' })
}

export async function fetchMessageFeedback(caller: Caller, sessionId: string, scope: MessageFeedbackScope): Promise<MessageFeedbackEntry[]> {
    return messageFeedbackEntrySchema.array().parse((await api<{ feedback: unknown }>(`/api/v1/conversations/${encodeURIComponent(sessionId)}/feedback?scope=${encodeURIComponent(scope)}`, caller)).feedback)
}

export async function rateMessage(caller: Caller, sessionId: string, vote: { scope: MessageFeedbackScope; messageId: string; rating: MessageFeedbackRating; messageText: string }): Promise<string> {
    return (await api<{ id: string }>(`/api/v1/conversations/${encodeURIComponent(sessionId)}/feedback`, { ...caller, method: 'POST', body: vote })).id
}

export async function updateMessageFeedback(caller: Caller, feedbackId: string, details: { category: MessageFeedbackCategory | null; details: string }): Promise<void> {
    await api(`/api/v1/feedback/${encodeURIComponent(feedbackId)}`, { ...caller, method: 'PATCH', body: details })
}

export async function clearMessageFeedback(caller: Caller, feedbackId: string): Promise<void> {
    await api(`/api/v1/feedback/${encodeURIComponent(feedbackId)}`, { ...caller, method: 'DELETE' })
}
