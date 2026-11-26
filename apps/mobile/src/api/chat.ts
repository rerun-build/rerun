import { TRANSCRIPT_UPDATED_AT_HEADER, mobileApi, type AgentView, type ConversationReply, type ConversationReplyResult, type Conversation, type ConversationMessage, type MessageFeedbackCategory, type MessageFeedbackEntry, type MessageFeedbackRating, type MessageFeedbackScope, type SkillProposal, type SkillProposalDecision } from '@rerun/contracts'

import { hub, hubConditional } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAgentView(caller: Caller, agentId: string): Promise<AgentView> {
    return hub(mobileApi.getAgent, { ...caller, params: { id: agentId } })
}

export async function fetchAgentConversations(caller: Caller, agentId: string): Promise<Conversation[]> {
    return hub(mobileApi.listAgentConversations, { ...caller, params: { id: agentId } })
}

// The transcript, unless it is still the one named `etag`: `messages` is then null. `updatedAt` is the
// version of the conversation it was read at, absent from a hub older than it.
export type TranscriptRead = { messages: ConversationMessage[] | null; etag: string | null; updatedAt: string | null }

export async function fetchMessages(caller: Caller, sessionId: string, etag: string | null = null): Promise<TranscriptRead> {
    const read = await hubConditional(mobileApi.getConversationMessages, { ...caller, params: { id: sessionId }, etag })
    return { messages: read.payload, etag: read.etag, updatedAt: read.headers.get(TRANSCRIPT_UPDATED_AT_HEADER) }
}

export async function fetchActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    return (await hub(mobileApi.getActiveRun, { ...caller, params: { id: sessionId } })).runId
}

// A reply goes whole, its tool calls with it. `messageId` is the id the transcript gives the message.
export async function deleteConversationMessage(caller: Caller, sessionId: string, messageId: string): Promise<void> {
    await hub(mobileApi.deleteConversationMessage, { ...caller, params: { id: sessionId, messageId } })
}

export async function stopConversation(caller: Caller, sessionId: string): Promise<void> {
    await hub(mobileApi.stopConversation, { ...caller, params: { id: sessionId } })
}

// The notification the conversation waited on was read: it goes back to idle.
export async function acknowledgeAlert(caller: Caller, sessionId: string): Promise<void> {
    await hub(mobileApi.acknowledgeConversation, { ...caller, params: { id: sessionId } })
}

export async function replyToConversation(caller: Caller, sessionId: string, reply: ConversationReply): Promise<ConversationReplyResult> {
    return hub(mobileApi.replyToConversation, { ...caller, params: { id: sessionId }, body: reply })
}

export async function fetchSkillProposals(caller: Caller, sessionId: string): Promise<SkillProposal[]> {
    return (await hub(mobileApi.listSkillProposals, { ...caller, params: { id: sessionId } })).proposals
}

export async function decideSkillProposal(caller: Caller, sessionId: string, proposalId: string, decision: SkillProposalDecision): Promise<SkillProposal> {
    return (await hub(mobileApi.decideSkillProposal, { ...caller, params: { id: sessionId }, body: { proposalId, decision } })).proposal
}

// The chat's Undo on a Brain change. A 409 means the page changed again since.
export async function revertBrainPage(caller: Caller, slug: string, revisionId: string, expectedHash?: string): Promise<void> {
    await hub(mobileApi.revertBrainPage, { ...caller, params: { slug }, body: { revisionId, expectedHash } })
}

export async function cancelSubRun(caller: Caller, agentId: string, runId: string, taskId: string): Promise<void> {
    await hub(mobileApi.cancelSubRun, { ...caller, params: { id: agentId, runId, taskId } })
}

export async function fetchMessageFeedback(caller: Caller, sessionId: string, scope: MessageFeedbackScope): Promise<MessageFeedbackEntry[]> {
    return (await hub(mobileApi.listMessageFeedback, { ...caller, params: { id: sessionId }, query: { scope } })).feedback
}

export async function rateMessage(caller: Caller, sessionId: string, vote: { scope: MessageFeedbackScope; messageId: string; rating: MessageFeedbackRating; messageText: string }): Promise<string> {
    return (await hub(mobileApi.rateMessage, { ...caller, params: { id: sessionId }, body: vote })).id
}

export async function updateMessageFeedback(caller: Caller, feedbackId: string, details: { category: MessageFeedbackCategory | null; details: string }): Promise<void> {
    await hub(mobileApi.updateMessageFeedback, { ...caller, params: { id: feedbackId }, body: details })
}

export async function clearMessageFeedback(caller: Caller, feedbackId: string): Promise<void> {
    await hub(mobileApi.clearMessageFeedback, { ...caller, params: { id: feedbackId } })
}
