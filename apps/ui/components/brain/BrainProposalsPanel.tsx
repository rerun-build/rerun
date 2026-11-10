'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { decideBrainProposalAction } from '@/app/api/_actions/brain.actions'
import { PageColumn } from '@/components/brain/BrainPageParts'
import { BrainTopBar } from '@/components/brain/BrainTopBar'
import { ProposalList } from '@/components/brain/proposals/ProposalList'
import { InboxIcon } from '@/lib/icons'
import type { BrainProposal } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

type BrainProposalsPanelProps = {
    proposals: BrainProposal[] | null
    onDecided: (proposal: BrainProposal, decision: 'accept' | 'dismiss') => void
    onOpenPage: (slug: string) => void
}

// What agents learned about the company and want written down. Nothing reaches a page until a
// person accepts it here.
export function BrainProposalsPanel({ proposals, onDecided, onOpenPage }: BrainProposalsPanelProps) {
    const t = useTranslations('brain.proposals')
    const errorText = useErrorText()
    const [busyId, setBusyId] = useState<string | null>(null)

    const decide = async (proposal: BrainProposal, decision: 'accept' | 'dismiss') => {
        setBusyId(proposal.id)
        const result = await decideBrainProposalAction(proposal.id, decision)
        setBusyId(null)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        if (decision === 'accept') toast.success(t('accepted', { title: proposal.title }), { action: { label: t('open'), onClick: () => onOpenPage(proposal.slug) } })
        onDecided(proposal, decision)
    }

    return (
        <>
            <BrainTopBar crumbs={[{ label: t('title'), icon: InboxIcon }]} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn className="max-w-[820px]">
                    <h1 className="text-[2rem] font-semibold leading-tight tracking-tight">{t('title')}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
                    <div className="mt-8">
                        <ProposalList proposals={proposals} busyId={busyId} onAccept={proposal => void decide(proposal, 'accept')} onDismiss={proposal => void decide(proposal, 'dismiss')} onOpenPage={onOpenPage} />
                    </div>
                </PageColumn>
            </div>
        </>
    )
}
