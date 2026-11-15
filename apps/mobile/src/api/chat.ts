import { activeRunSchema, agentViewSchema, conversationMessageSchema, conversationSchema, messageFeedbackEntrySchema, skillProposalSchema, skillProposalsListSchema, type AgentView, type Conversation, type ConversationMessage, type MessageFeedbackCategory, type MessageFeedbackEntry, type MessageFeedbackRating, type MessageFeedbackScope, type SkillProposal, type SkillProposalDecision } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAgentView(caller: Caller, agentId: string): Promise<AgentView> {
    return agentViewSchema.parse(await api(`/api/v1/agents/${encodeURIComponent(agentId)}`, caller))
}

export async function fetchAgentConversations(caller: Caller, agentId: string): Promise<Conversation[]> {
    return conversationSchema.array().parse(await api(`/api/v1/agents/${encodeURIComponent(agentId)}/conversations`, caller))
}

export async function fetchMessages(caller: Caller, sessionId: string): Promise<ConversationMessage[]> {
    return conversationMessageSchema.array().parse(await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/messages`, caller))
}

export async function fetchActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    return activeRunSchema.parse(await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/active-run`, caller)).runId
}

export async function stopConversation(caller: Caller, sessionId: string): Promise<void> {
    await api(`/api/v1/conversations/${encodeURIComponent(sessionId)}/stop`, { ...caller, method: 'POST' })
}

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
