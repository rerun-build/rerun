'use client'

import { FOREMAN_AGENT_ID, skillProposalIdOf } from '@rerun/contracts'
import type { ReactNode } from 'react'

import { SkillProposalBlock } from '@/components/chat/SkillProposalBlock'
import type { SkillProposals } from '@/hooks/useSkillProposals'

export type ForemanSkillProposals = Pick<SkillProposals, 'proposals' | 'pinnedIds' | 'pendingId' | 'decide'> & {
    // Its skills are on its card, not on a coworker's panel of the board.
    onOpenSkill: (slug: string) => void
}

// The row a `skill_propose` call leaves in the transcript once its decision has landed, as a
// coworker's chat draws it. While the dock above the field holds it, the spot stays empty.
export function skillProposalRow(output: unknown, { proposals, pinnedIds, pendingId, decide, onOpenSkill }: ForemanSkillProposals): ReactNode | null {
    const proposalId = skillProposalIdOf(output)
    const proposal = proposalId && !pinnedIds.has(proposalId) ? proposals.get(proposalId) : undefined
    if (!proposal) return null
    return <SkillProposalBlock agentId={FOREMAN_AGENT_ID} proposal={proposal} pending={pendingId === proposal.id} onDecide={decide} onOpenSkill={onOpenSkill} />
}
