'use server'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { deniedCode, type DeniedCode } from '@/app/api/_auth/access'
import { decideCoworkerSkillProposal, resolveAgentTarget, getSessionEngineContext } from '@/app/api/_services/chat.service'
import { decideSkillProposal, listSkillProposals } from '@/lib/engine/client'
import type { EngineModelPick, EngineSkillProposal } from '@/lib/engine/types'
import { clearForemanSkillProposalAttention } from '@/lib/foreman/conversation'
import { refusal, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'

export async function listSkillProposalsAction(sessionId: string): Promise<EngineSkillProposal[]> {
    try {
        const ctx = await getSessionEngineContext(sessionId)
        if (!ctx?.engineSessionId) return []
        return await listSkillProposals(ctx.conn, ctx.engineAgentId, ctx.engineSessionId)
    } catch {
        return []
    }
}

// Deciding writes, or turns down, a procedure of the coworker: `manage` on its Box, either way. On
// the Chief of Staff, which sits in no Box, a workspace admin. `model` is what the conversation is set to.
export async function decideSkillProposalAction(
    sessionId: string,
    proposalId: string,
    decision: 'accept' | 'dismiss',
    model?: EngineModelPick
): Promise<{ success: boolean; proposal?: EngineSkillProposal; denied?: DeniedCode } & Partial<ActionRefusal>> {
    try {
        const ctx = await getSessionEngineContext(sessionId)
        if (!ctx) return { success: false, ...refusal('coworkerNotReachable') }
        if (ctx.engineAgentId !== FOREMAN_AGENT_ID) return { success: true, proposal: await decideCoworkerSkillProposal(ctx, sessionId, proposalId, decision, undefined, model) }
        await resolveAgentTarget(ctx.agentId, 'manage')
        const proposal = await decideSkillProposal(ctx.conn, ctx.engineAgentId, proposalId, decision, model)
        await clearForemanSkillProposalAttention(ctx.conn, sessionId, ctx.engineSessionId).catch(() => {})
        return { success: true, proposal }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'updateProposalFailed'), denied: deniedCode(err) }
    }
}
