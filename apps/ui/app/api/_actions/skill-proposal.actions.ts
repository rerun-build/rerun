'use server'

import { deniedCode, type DeniedCode } from '@/app/api/_auth/access'
import { clearSkillProposalAttention, getAgentChatTarget, getSessionEngineContext } from '@/app/api/_services/chat.service'
import { decideSkillProposal, listSkillProposals } from '@/lib/engine/client'
import type { EngineSkillProposal } from '@/lib/engine/types'
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

// Deciding writes, or turns down, a procedure of the coworker: `manage` on its Box, either way. A
// sealed agent's procedures belong to the template it came from, so it does not get to rewrite
// them from a chat row.
export async function decideSkillProposalAction(
    sessionId: string,
    proposalId: string,
    decision: 'accept' | 'dismiss'
): Promise<{ success: boolean; proposal?: EngineSkillProposal; denied?: DeniedCode } & Partial<ActionRefusal>> {
    try {
        const ctx = await getSessionEngineContext(sessionId)
        if (!ctx) return { success: false, ...refusal('coworkerNotReachable') }
        const { contentLocked } = await getAgentChatTarget(ctx.agentId, 'manage')
        if (decision === 'accept' && contentLocked) return { success: false, ...refusal('upgradeToEditContent') }
        const proposal = await decideSkillProposal(ctx.conn, ctx.engineAgentId, proposalId, decision)
        await clearSkillProposalAttention(sessionId, ctx.agentId, ctx.engineSessionId).catch(() => {})
        return { success: true, proposal }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'updateProposalFailed'), denied: deniedCode(err) }
    }
}
