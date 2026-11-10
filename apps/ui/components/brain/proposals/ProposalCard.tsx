'use client'

import { Button } from '@/components/ui/button'
import { beamAngle, proposalHeadline } from '@/lib/brain/proposal-sections'
import { CheckIcon, ChevronDownIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BrainProposal } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Byline, CoworkerBuddy, Details, Expandable, FactChanges, When } from './parts'

type ProposalCardProps = {
    proposal: BrainProposal
    busy: boolean
    onAccept: () => void
    onDismiss: () => void
    onOpenPage: (slug: string) => void
}

export function ProposalCard({ proposal, busy, onAccept, onDismiss, onOpenPage }: ProposalCardProps) {
    const t = useTranslations('brain.proposals')
    const [open, setOpen] = useState(false)

    return (
        <article className="relative rounded-2xl bg-background p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_16px_-6px_rgba(0,0,0,0.12)]">
            <BorderBeam pattern="arcs" tone="neutral" angle={beamAngle(proposal.id)} className="opacity-70" />
            <div className="flex gap-4">
                <CoworkerBuddy proposal={proposal} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                        <h3 className="flex-1 text-[22px] leading-snug font-bold tracking-tight">{proposalHeadline(proposal, t)}</h3>
                        <When proposal={proposal} />
                    </div>
                    <div className="mt-1.5">
                        <Byline proposal={proposal} onOpenPage={onOpenPage} />
                    </div>
                    <div className="mt-4">
                        <FactChanges proposal={proposal} />
                    </div>
                    <footer className="mt-4 flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open}>
                            {open ? t('hideDetails') : t('moreDetails')}
                            <ChevronDownIcon className={cn('transition-transform duration-200', open && 'rotate-180')} />
                        </Button>
                        <div className="ml-auto flex items-center gap-1.5">
                            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onDismiss} disabled={busy}>
                                {t('dismiss')}
                            </Button>
                            <Button size="sm" onClick={onAccept} loading={busy}>
                                <CheckIcon />
                                {t('accept')}
                            </Button>
                        </div>
                    </footer>
                    <Expandable open={open}>
                        <Details proposal={proposal} />
                    </Expandable>
                </div>
            </div>
        </article>
    )
}
