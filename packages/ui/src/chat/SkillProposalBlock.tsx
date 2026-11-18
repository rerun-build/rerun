'use client'

import { motion } from 'motion/react'
import { useState } from 'react'

import { Button, Icon, IconBadge, Stripes } from '../primitives'
import { cn } from '../cn'
import { TooltipDisabledReason } from '../Tooltip'
import { BrainIcon, CheckIcon, ChevronDownIcon, XIcon } from '../icons'
import { useKitTranslations } from '../locale'
import type { KitTranslator } from '../kit-translator'

export type SkillProposalMode = 'create' | 'edit'
export type SkillProposalState = 'proposed' | 'accepted' | 'applied' | 'failed' | 'dismissed'

export type SkillProposalBlockProps = {
    mode: SkillProposalMode
    title: string
    summary: string
    state: SkillProposalState
    count?: number
    instructions?: string[]
    error?: string | null
    pending?: boolean
    pinned?: boolean
    onAccept?: () => void
    onDismiss?: () => void
    decisionDisabledReason?: string
    onOpenSkill?: () => void
    className?: string
}

type Copy = { headline: string; detail: string; accept?: string; dismiss?: string }

function copyFor({ title, summary, state, error }: SkillProposalBlockProps, t: KitTranslator): Copy {
    if (state === 'accepted') return { headline: t('chat.skillProposal.remembering'), detail: title }
    if (state === 'applied') return { headline: t('chat.skillProposal.remembered'), detail: title }
    if (state === 'failed') return { headline: t('chat.skillProposal.failed'), detail: error || title, accept: t('chat.skillProposal.retry'), dismiss: t('chat.skillProposal.dismiss') }
    if (state === 'dismissed') return { headline: t('chat.skillProposal.notRemembered'), detail: title }
    return { headline: title, detail: summary, accept: t('chat.skillProposal.remember'), dismiss: t('chat.skillProposal.no') }
}

export function SkillProposalBlock(props: SkillProposalBlockProps) {
    const { state, pinned, onOpenSkill, className } = props
    const t = useKitTranslations()
    const { headline, detail, accept, dismiss } = copyFor(props, t)
    const open = state === 'proposed' || state === 'failed'
    const done = state === 'applied'

    if (pinned && open) return <PinnedDecision {...props} headline={headline} detail={detail} accept={accept} dismiss={dismiss} />

    return (
        <div className={cn(pinned ? 'relative overflow-hidden rounded-lg border border-border bg-card p-3' : cn('rounded-xl px-1.5 py-1.5', open && 'bg-muted/30'), className)}>
            {pinned && <Stripes fade="bottom" />}
            <div className="relative flex items-center gap-3 text-sm">
                <Icon size="sm" icon={BrainIcon} />
                <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{headline}</span>
                    <span className={cn('block truncate text-xs', state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{detail}</span>
                </div>
                {state === 'accepted' && <IconBadge tone="brand" animated />}
                {state === 'dismissed' && <IconBadge tone="neutral" icon={XIcon} glow={false} />}
                {done && (
                    <>
                        <IconBadge tone="green" icon={CheckIcon} glow={false} />
                        {onOpenSkill && (
                            <Button size="xs" variant="ghost" onClick={onOpenSkill}>
                                {t('chat.skillProposal.view')}
                            </Button>
                        )}
                    </>
                )}
                {open && <DecisionButtons {...props} accept={accept} dismiss={dismiss} className={undefined} />}
            </div>
        </div>
    )
}

const COLLAPSED_DETAIL_HEIGHT = 18

function PinnedDecision(props: SkillProposalBlockProps & Copy) {
    const { state, instructions = [], className, headline, detail } = props
    const t = useKitTranslations()
    const [expanded, setExpanded] = useState(false)
    const [unfolded, setUnfolded] = useState(false)
    const failed = state === 'failed'
    const toggle = () => {
        if (!expanded) setUnfolded(true)
        setExpanded(!expanded)
    }

    return (
        <div className={cn('relative overflow-hidden rounded-lg border border-border bg-card p-3', className)}>
            <Stripes fade="bottom" />
            <div className={cn('relative flex flex-wrap gap-3 text-sm sm:flex-nowrap', unfolded ? 'items-start' : 'items-center')}>
                <Icon size="sm" icon={BrainIcon} />
                <button type="button" aria-expanded={expanded} aria-label={expanded ? t('chat.skillProposal.hideDetails') : t('chat.skillProposal.showDetails')} onClick={toggle} className="group min-w-0 flex-1 cursor-pointer text-left">
                    <span className={cn('flex gap-1', unfolded ? 'items-start' : 'items-center')}>
                        <span className={cn('font-medium', unfolded ? 'break-words' : 'truncate')}>{headline}</span>
                        <ChevronDownIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition group-hover:text-foreground', unfolded && 'mt-1', expanded && 'rotate-180')} />
                    </span>
                    <motion.span
                        initial={false}
                        animate={{ height: expanded ? 'auto' : COLLAPSED_DETAIL_HEIGHT }}
                        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                        onAnimationComplete={() => !expanded && setUnfolded(false)}
                        className="block overflow-hidden text-xs text-muted-foreground"
                    >
                        {unfolded ? (
                            <span className="block space-y-1.5 break-words">
                                <span className={cn('block', failed && 'text-destructive')}>{detail}</span>
                                {!failed && instructions.length > 0 && (
                                    <ul className="list-disc space-y-1 pl-4">
                                        {instructions.map((instruction, index) => (
                                            <li key={index} className="whitespace-pre-line">
                                                {instruction}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </span>
                        ) : (
                            <span className={cn('block truncate', failed && 'text-destructive')}>{detail}</span>
                        )}
                    </motion.span>
                </button>
                <DecisionButtons {...props} className="max-sm:basis-full max-sm:justify-end" />
            </div>
        </div>
    )
}

function DecisionButtons({ pending, onAccept, onDismiss, decisionDisabledReason, accept, dismiss, className }: SkillProposalBlockProps & Pick<Copy, 'accept' | 'dismiss'>) {
    const blocked = !!decisionDisabledReason
    return (
        <TooltipDisabledReason reason={decisionDisabledReason} className={cn('shrink-0', className)}>
            <div className={cn('flex shrink-0 items-center gap-1', className)}>
                {onDismiss && dismiss && (
                    <Button size="xs" variant="ghost" disabled={pending || blocked} onClick={onDismiss}>
                        {dismiss}
                    </Button>
                )}
                {onAccept && accept && (
                    <Button size="xs" loading={pending} disabled={blocked} onClick={onAccept}>
                        {accept}
                    </Button>
                )}
            </div>
        </TooltipDisabledReason>
    )
}
