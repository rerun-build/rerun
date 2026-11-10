'use client'

import { Gauge } from '@/components/ui/gauge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'

export type ContextUsage = {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
}

export type ContextProps = {
    usedTokens: number
    maxTokens?: number
    usage?: ContextUsage
    modelId?: string
}

function toneFor(ratio: number): string {
    if (ratio >= 0.85) return 'text-destructive'
    if (ratio >= 0.6) return 'text-amber-500'
    return 'text-emerald-500'
}

function UsageRow({ label, value }: { label: string; value: number }) {
    const locale = useLocale()
    if (!value) return null
    return (
        <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{formatNumber(value, locale)}</span>
        </div>
    )
}

export function Context({ usedTokens, maxTokens, usage, modelId }: ContextProps) {
    const t = useTranslations('chat.context')
    const locale = useLocale()
    if (!maxTokens || usedTokens <= 0) return null
    const ratio = usedTokens / maxTokens
    const percent = Math.round(ratio * 100)
    const tone = toneFor(ratio)

    return (
        <HoverCard openDelay={120} closeDelay={80}>
            <HoverCardTrigger asChild>
                <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={t('usedLabel', { percent })}>
                    <Gauge ratio={ratio} className={tone} />
                </button>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-56">
                <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="text-xs font-medium">{t('title')}</span>
                    <span className={cn('text-xs font-medium tabular-nums', tone)}>{percent}%</span>
                </div>
                <div className="space-y-1">
                    <UsageRow label={t('input')} value={usage?.inputTokens ?? 0} />
                    <UsageRow label={t('cached')} value={usage?.cachedInputTokens ?? 0} />
                    <UsageRow label={t('reasoning')} value={usage?.reasoningTokens ?? 0} />
                    <UsageRow label={t('output')} value={usage?.outputTokens ?? 0} />
                    <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 text-xs">
                        <span className="text-muted-foreground">{t('total')}</span>
                        <span className="tabular-nums">
                            {formatNumber(usedTokens, locale)} / {formatNumber(maxTokens, locale)}
                        </span>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    )
}
