'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { brainSourceLabels } from '@/lib/brain/labels'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { beamAngle, humanAgentName, proposalChanges, type SectionChange } from '@/lib/brain/proposal-sections'
import { ArrowRightIcon, CheckCheckIcon, PlusIcon } from '@/lib/icons'
import { shortRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BrainProposal } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Prose } from './Prose'

const BUDDY_SIZE = 56

// The coworker's mascot, the same block, colour and eyes as on the board, drawn from its id.
export function CoworkerBuddy({ proposal }: { proposal: BrainProposal }) {
    return <AgentBuddy agentId={proposal.agentId} size={BUDDY_SIZE} animated={false} facing="right" />
}

const PAGE_TAG = 'inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground'

// A new page has nothing to open yet.
function PageTag({ proposal, onOpenPage }: { proposal: BrainProposal; onOpenPage: (slug: string) => void }) {
    const PageIcon = BRAIN_PAGE_ICONS[proposal.type]
    const content = (
        <>
            <PageIcon className="size-3.5 text-muted-foreground" />
            {proposal.title}
        </>
    )
    if (proposal.mode === 'create') return <span className={PAGE_TAG}>{content}</span>
    return (
        <button type="button" onClick={() => onOpenPage(proposal.slug)} className={cn(PAGE_TAG, 'transition-colors hover:bg-muted')}>
            {content}
        </button>
    )
}

export function When({ proposal }: { proposal: BrainProposal }) {
    const locale = useLocale()
    return <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{shortRelativeTime(proposal.createdAt, locale)}</span>
}

function Sources({ proposal }: { proposal: BrainProposal }) {
    const t = useTranslations('brain.proposals')
    const tBrain = useTranslations('brain')
    if (!proposal.sources.length) return null
    return <p className="text-xs text-muted-foreground">{t('basedOn', { sources: brainSourceLabels(proposal.sources, tBrain).join(', ') })}</p>
}

export function AllCaughtUp() {
    const t = useTranslations('brain.proposals')
    return (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCheckIcon className="size-5" />
            </span>
            <p className="text-sm font-medium">{t('allCaughtUp')}</p>
            <p className="max-w-xs text-xs text-muted-foreground">{t('allCaughtUpHint')}</p>
        </div>
    )
}

export function ProposalCardSkeleton() {
    return (
        <div className="flex gap-4 rounded-2xl border border-border/80 p-5">
            <Skeleton className="size-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="mt-3 h-4 w-2/5" />
                <Skeleton className="mt-5 h-3 w-16" />
                <div className="mt-2 flex items-center gap-2">
                    <Skeleton className="h-8 w-28 rounded-full" />
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-8 w-48 rounded-full" />
                </div>
                <div className="mt-5 flex items-center gap-2">
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="ml-auto h-8 w-16" />
                    <Skeleton className="h-8 w-20" />
                </div>
            </div>
        </div>
    )
}

export function Expandable({ open, children }: { open: boolean; children: ReactNode }) {
    return (
        <AnimatePresence initial={false}>
            {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden">
                    <div className="p-px">{children}</div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export function Byline({ proposal, onOpenPage }: { proposal: BrainProposal; onOpenPage: (slug: string) => void }) {
    const t = useTranslations('brain.proposals')
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            {t.rich(proposal.mode === 'create' ? 'bylineCreate' : 'bylineEdit', {
                name: humanAgentName(proposal.agentName),
                agent: chunks => <span className="font-medium text-foreground/80">{chunks}</span>,
                page: () => <PageTag proposal={proposal} onOpenPage={onOpenPage} />,
            })}
            {proposal.outdated && (
                <Badge size="xs" tone="orange" glow={false}>
                    {t('pageChanged')}
                </Badge>
            )}
        </div>
    )
}

// What the page says now, struck through in red, and what it will say once accepted, in green.
export function FactChanges({ proposal }: { proposal: BrainProposal }) {
    if (!proposal.highlights.length) return <p className="text-sm">{proposal.reason}</p>
    return (
        <div className="space-y-3">
            {proposal.highlights.map(fact => (
                <div key={fact.label}>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">{fact.label}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        {fact.before ? (
                            <>
                                <span className="relative rounded-full bg-red-500/[0.02] px-3 py-1.5 text-sm text-red-700 line-through decoration-red-700/50 dark:text-red-400 dark:decoration-red-400/50">
                                    <BorderBeam pattern="arcs" tone="red" angle={beamAngle(`${proposal.id}:${fact.label}:before`)} className="opacity-25" />
                                    {fact.before}
                                </span>
                                <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                                </span>
                            </>
                        ) : (
                            <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10">
                                <PlusIcon className="size-3.5 text-emerald-600" />
                            </span>
                        )}
                        <span className="relative rounded-full bg-emerald-500/[0.02] px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                            <BorderBeam pattern="arcs" tone="green" angle={beamAngle(`${proposal.id}:${fact.label}:after`)} className="opacity-25" />
                            {fact.after}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    )
}

function NowAfter({ change }: { change: SectionChange }) {
    const t = useTranslations('brain.proposals')
    return (
        <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/50 p-3">
                <p className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{t('now')}</p>
                {change.before ? <Prose markdown={change.before} className="text-muted-foreground" /> : <p className="text-sm text-muted-foreground italic">{t('nothingYet')}</p>}
            </div>
            <div className="relative rounded-lg bg-emerald-500/[0.02] p-3">
                <BorderBeam pattern="arcs" tone="green" angle={beamAngle(`${change.key}:after`)} className="opacity-25" />
                <p className="mb-1.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">{t('after')}</p>
                {change.after ? <Prose markdown={change.after} /> : <p className="text-sm text-muted-foreground italic">{t('removed')}</p>}
            </div>
        </div>
    )
}

export function Details({ proposal }: { proposal: BrainProposal }) {
    const t = useTranslations('brain.proposals')
    return (
        <div className="mt-4 space-y-4 rounded-xl bg-muted/40 p-4">
            {proposal.outdated && (
                <p className="text-xs text-muted-foreground">
                    {proposal.mode === 'create' ? t('outdatedCreate') : t('outdatedEdit')}
                </p>
            )}
            {proposal.highlights.length > 0 && <p className="text-sm">{proposal.reason}</p>}
            <Sources proposal={proposal} />
            {proposalChanges(proposal).map(change => (
                <div key={change.key} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{change.heading ?? t('intro')}</p>
                    <NowAfter change={change} />
                </div>
            ))}
        </div>
    )
}
