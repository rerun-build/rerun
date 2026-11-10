'use client'

import { SkillProposalBlock as SkillProposalBlockBase } from '@rerun/ui/chat'
import { boxAccessFor } from '@/lib/board/box-access'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { useBoardStore } from '@/stores/board.store'
import { useOptionalSession } from '@/supabase/session/SessionProvider'
import type { EngineSkillProposal } from '@/lib/engine/types'

export type SkillProposalBlockProps = {
    agentId?: string
    proposal: EngineSkillProposal
    pending?: boolean
    pinned?: boolean
    onDecide?: (proposalId: string, decision: 'accept' | 'dismiss') => void
}

export function SkillProposalBlock({ agentId, proposal, pending, pinned, onDecide }: SkillProposalBlockProps) {
    const boxManageReason = useBoxManageReason()
    const openAgentSkill = useBoardStore(s => s.openAgentSkill)
    const canManage = useCanDecide(agentId)
    const decidable = Boolean(onDecide)
    const appliedSlug = proposal.appliedSlug

    return (
        <SkillProposalBlockBase
            mode={proposal.mode}
            title={proposal.title}
            summary={proposal.summary}
            state={proposal.status}
            count={proposal.instructions.length}
            instructions={proposal.instructions}
            error={proposal.error}
            pending={pending}
            pinned={pinned}
            onAccept={decidable ? () => onDecide?.(proposal.id, 'accept') : undefined}
            onDismiss={decidable ? () => onDecide?.(proposal.id, 'dismiss') : undefined}
            decisionDisabledReason={canManage ? undefined : boxManageReason}
            onOpenSkill={agentId && appliedSlug ? () => openAgentSkill(agentId, appliedSlug) : undefined}
        />
    )
}

// The labs draw this card with no session behind it, where `useCanManageAgent` would throw: there
// the decision stays open, as it was before access by Box.
function useCanDecide(agentId: string | undefined): boolean {
    const session = useOptionalSession()
    const space = useBoardStore(state => {
        const spaceId = state.agents.find(agent => agent.id === agentId)?.spaceId
        return spaceId ? state.spaces.find(candidate => candidate.id === spaceId) : undefined
    })
    const grants = useBoardStore(state => state.spaceGrants)
    if (!session) return true
    return boxAccessFor({ userId: session.user?.id ?? null, role: session.role, boxScope: session.boxScope }, space, grants) === 'manage'
}
