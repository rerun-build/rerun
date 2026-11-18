'use server'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { deniedCode, type DeniedCode } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { clearSkillProposalAttention, getAgentChatTarget, getSessionEngineContext, type SessionEngineContext } from '@/app/api/_services/chat.service'
import { decideSkillProposal, listSkillProposals } from '@/lib/engine/client'
import type { EngineSkillProposal } from '@/lib/engine/types'
import { foremanSessionEngineContext } from '@/lib/foreman/conversation'
import { refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'

// A coworker's session, or else one of the caller's own conversations with the Chief of Staff.
async function proposalContextOf(sessionId: string): Promise<SessionEngineContext | null> {
    try {
        return await getSessionEngineContext(sessionId)
    } catch (err) {
        const foreman = await foremanSessionEngineContext(await requireWorkspaceContext(), sessionId)
        if (!foreman) throw err
        return { agentId: FOREMAN_AGENT_ID, engineAgentId: FOREMAN_AGENT_ID, ...foreman }
    }
}

export async function listSkillProposalsAction(sessionId: string): Promise<EngineSkillProposal[]> {
    try {
        const ctx = await proposalContextOf(sessionId)
        if (!ctx?.engineSessionId) return []
        return await listSkillProposals(ctx.conn, ctx.engineAgentId, ctx.engineSessionId)
    } catch {
        return []
    }
}

// Deciding writes, or turns down, a procedure of the coworker: `manage` on its Box, either way. On
// the Chief of Staff, which sits in no Box, a workspace admin.
export async function decideSkillProposalAction(
    sessionId: string,
    proposalId: string,
    decision: 'accept' | 'dismiss'
): Promise<{ success: boolean; proposal?: EngineSkillProposal; denied?: DeniedCode } & Partial<ActionRefusal>> {
    try {
        const ctx = await proposalContextOf(sessionId)
        if (!ctx) return { success: false, ...refusal('coworkerNotReachable') }
        await getAgentChatTarget(ctx.agentId, 'manage')
        const proposal = await decideSkillProposal(ctx.conn, ctx.engineAgentId, proposalId, decision)
        if (ctx.agentId !== FOREMAN_AGENT_ID) await clearSkillProposalAttention(sessionId, ctx.agentId, ctx.engineSessionId).catch(() => {})
        return { success: true, proposal }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'updateProposalFailed'), denied: deniedCode(err) }
    }
}
