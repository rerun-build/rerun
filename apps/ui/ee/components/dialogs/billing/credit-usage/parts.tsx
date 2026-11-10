'use client'

import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useLocale, useTranslations } from 'next-intl'
import { createElement } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type CreditBalance, type CreditCoworker, type CreditKind, type CreditSource } from '@/ee/lib/billing/credit-usage'
import { formatCredits } from '@/ee/lib/billing/plans'
import { BrainIcon, CpuIcon, UsersIcon, ZapIcon, type LucideIcon } from '@/lib/icons'
import { paidDataIcon } from '@/lib/paid-data/spend'
import { cn } from '@/lib/utils'

// Validated with the dataviz palette checker against both surfaces: indigo is the brand, amber stays
// apart from it under every colour-vision deficiency.
export const KIND_FILL: Record<CreditKind, string> = {
    ai: 'bg-[#4d34f7] dark:bg-[#7a66ff]',
    data: 'bg-[#c27a12] dark:bg-[#c8841f]',
}

const TIER_ICON = { fast: ZapIcon, balanced: CpuIcon, smart: BrainIcon } satisfies Record<string, LucideIcon>

function sourceIcon(source: CreditSource): LucideIcon {
    return source.kind === 'ai' ? TIER_ICON[source.tier] : paidDataIcon(source.capability)
}

// A Rerun model reads by its tier, a paid data source by its capability.
export function useSourceLabel(): (source: CreditSource) => string {
    const t = useTranslations('billing')
    return source => (source.kind === 'ai' ? t(`usage.tier.${source.tier}`) : t(`usage.paidData.${source.capability}`))
}

export function Swatch({ kind, className }: { kind: CreditKind; className?: string }) {
    return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-[2px]', KIND_FILL[kind], className)} />
}

export function SourceChip({ source }: { source: CreditSource }) {
    return (
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-border">
            {createElement(sourceIcon(source), { className: 'size-3.5 text-muted-foreground' })}
            <Swatch kind={source.kind} className="absolute -right-0.5 -bottom-0.5 size-2 ring-2 ring-popover" />
        </span>
    )
}

export function CoworkerAvatar({ coworker }: { coworker: CreditCoworker }) {
    if (coworker) return <AgentBuddy agentId={coworker.id} size={28} animated={false} facing="right" />
    return (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border">
            <UsersIcon className="size-3.5 text-muted-foreground" />
        </span>
    )
}

const HATCH = { backgroundImage: 'repeating-linear-gradient(65deg, color-mix(in oklab, var(--muted-foreground) 45%, transparent) 0 2px, transparent 2px 5px)' }

type Segment = { key: string; micros: number; className: string; label: string; hatched?: boolean }

// The whole credit on one track: what AI and paid data spent, then what is left of the month, then
// the top-up that outlives the reset, hatched so it reads as a reserve rather than more month. A
// trial's credit is all top-up and never resets, so it is simply what is left.
export function SplitBar({ balance, trial = false }: { balance: CreditBalance; trial?: boolean }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const figure = (micros: number) => formatCredits(micros, locale)
    const segments: Segment[] = [
        { key: 'ai', micros: balance.usedAiMicros, className: KIND_FILL.ai, label: t('usage.bar.aiSpent', { figure: figure(balance.usedAiMicros) }) },
        { key: 'data', micros: balance.usedDataMicros, className: KIND_FILL.data, label: t('usage.bar.dataSpent', { figure: figure(balance.usedDataMicros) }) },
        { key: 'month', micros: balance.monthLeftMicros, className: 'bg-muted-foreground/20', label: t('usage.bar.leftThisMonth', { figure: figure(balance.monthLeftMicros) }) },
        trial
            ? { key: 'topup', micros: balance.topupLeftMicros, className: 'bg-muted-foreground/20', label: t('usage.bar.left', { figure: figure(balance.topupLeftMicros) }) }
            : { key: 'topup', micros: balance.topupLeftMicros, className: 'bg-muted-foreground/15', label: t('usage.bar.topup', { figure: figure(balance.topupLeftMicros) }), hatched: true },
    ].filter(segment => segment.micros > 0)

    if (segments.length === 0) return <div className="h-2.5 w-full rounded-full bg-muted-foreground/20" />

    return (
        <div className="flex h-2.5 w-full gap-0.5">
            {segments.map(segment => (
                <Tooltip key={segment.key}>
                    <TooltipTrigger asChild>
                        <span className={cn('relative h-full min-w-1 overflow-hidden first:rounded-l-full last:rounded-r-full', segment.className)} style={{ flexGrow: segment.micros, flexBasis: 0 }}>
                            {segment.hatched && <span aria-hidden className="absolute inset-0" style={HATCH} />}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{segment.label}</TooltipContent>
                </Tooltip>
            ))}
        </div>
    )
}

export function KindLegend({ balance }: { balance: CreditBalance }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['ai', 'data'] as const).map(kind => (
                <span key={kind} className="flex items-center gap-1.5">
                    <Swatch kind={kind} />
                    {t(`usage.kind.${kind}`)}
                    <span className="text-foreground tabular-nums">{formatCredits(kind === 'ai' ? balance.usedAiMicros : balance.usedDataMicros, locale)}</span>
                </span>
            ))}
            <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-[2px] bg-muted-foreground/25" />
                {t('usage.legendLeft')}
                <span className="text-foreground tabular-nums">{formatCredits(balance.leftMicros, locale)}</span>
            </span>
        </div>
    )
}
