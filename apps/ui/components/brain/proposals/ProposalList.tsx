'use client'

import type { BrainProposal } from '@moldwright/contracts'
import { AnimatePresence, motion } from 'motion/react'

import { AllCaughtUp, ProposalCardSkeleton } from './parts'
import { ProposalCard } from './ProposalCard'

type ProposalListProps = {
    proposals: BrainProposal[] | null
    busyId: string | null
    onAccept: (proposal: BrainProposal) => void
    onDismiss: (proposal: BrainProposal) => void
    onOpenPage: (slug: string) => void
}

const SKELETON_CARDS = 3

export function ProposalList({ proposals, busyId, onAccept, onDismiss, onOpenPage }: ProposalListProps) {
    if (!proposals) {
        return (
            <div className="flex flex-col gap-3">
                {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                    <ProposalCardSkeleton key={index} />
                ))}
            </div>
        )
    }
    if (!proposals.length) return <AllCaughtUp />
    return (
        <div className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
                {proposals.map(proposal => (
                    <motion.div key={proposal.id} layout exit={{ opacity: 0, height: 0, scale: 0.98 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
                        <ProposalCard proposal={proposal} busy={busyId === proposal.id} onAccept={() => onAccept(proposal)} onDismiss={() => onDismiss(proposal)} onOpenPage={onOpenPage} />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}
