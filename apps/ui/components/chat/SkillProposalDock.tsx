'use client'

import { AnimatePresence, motion } from 'motion/react'
import { SkillProposalBlock } from '@/components/chat/SkillProposalBlock'
import type { EngineSkillProposal } from '@/lib/engine/types'

export type SkillProposalDockProps = {
    agentId?: string
    proposals: EngineSkillProposal[]
    pendingId?: string | null
    onDecide?: (proposalId: string, decision: 'accept' | 'dismiss') => void
}

export function SkillProposalDock({ agentId, proposals, pendingId, onDecide }: SkillProposalDockProps) {
    return (
        <div className="max-h-[34vh] overflow-y-auto">
            <AnimatePresence initial={false}>
                {proposals.map(proposal => (
                    <motion.div key={proposal.id} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }} className="overflow-hidden">
                        <div className="pb-2">
                            <SkillProposalBlock pinned agentId={agentId} proposal={proposal} pending={pendingId === proposal.id} onDecide={onDecide} />
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}
