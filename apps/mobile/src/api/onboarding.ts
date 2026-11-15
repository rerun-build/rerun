import { foremanIndustryResultSchema, foremanLeadResultSchema, foremanTrialResultSchema, type ForemanIntakeRequest, type TemplateCategory } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const BASE = '/api/v1/foreman'

export async function saveIntake(caller: Caller, intake: ForemanIntakeRequest): Promise<void> {
    await api(`${BASE}/intake`, { ...caller, method: 'POST', body: intake })
}

export async function decideIndustry(caller: Caller, input: string): Promise<TemplateCategory | null> {
    return foremanIndustryResultSchema.parse(await api(`${BASE}/industry`, { ...caller, method: 'POST', body: { input } })).industry
}

export async function startTeam(caller: Caller): Promise<boolean> {
    return foremanTrialResultSchema.parse(await api(`${BASE}/trial`, { ...caller, method: 'POST' })).entitled
}

export async function startLead(caller: Caller, agentId: string): Promise<{ conversationId: string; runId: string | null }> {
    return foremanLeadResultSchema.parse(await api(`${BASE}/lead`, { ...caller, method: 'POST', body: { agentId } }))
}

export type OnboardingConversation = { sessionId: string; messages: UIMessage[] }

export async function fetchOnboardingConversation(caller: Caller): Promise<OnboardingConversation | null> {
    const conversation = await api<{ sessionId?: string; backend?: string; messages?: UIMessage[] } | null>('/api/chat/foreman', caller)
    if (!conversation?.sessionId || conversation.backend === 'engine') return null
    return { sessionId: conversation.sessionId, messages: conversation.messages ?? [] }
}
