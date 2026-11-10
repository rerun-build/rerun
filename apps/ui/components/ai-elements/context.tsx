'use client'

import { Gauge } from '@/components/ui/gauge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

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
    return ratio >= 0.85 ? 'text-destructive' : 'text-amber-500'
}

function UsageRow({ label, value }: { label: string; value: number }) {
    if (!value) return null
    return (
        <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value.toLocaleString()}</span>
        </div>
    )
}

// The gauge only shows once the context is getting short: below this there is nothing to act on.
const CONTEXT_GAUGE_FROM = 0.75

export function Context({ usedTokens, maxTokens, usage, modelId }: ContextProps) {
    if (!maxTokens || usedTokens <= 0) return null
    const ratio = usedTokens / maxTokens
    if (ratio < CONTEXT_GAUGE_FROM) return null
    const percent = Math.round(ratio * 100)
    const tone = toneFor(ratio)

    return (
        <HoverCard openDelay={120} closeDelay={80}>
            <HoverCardTrigger asChild>
                <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={`Context used: ${percent}%`}>
                    <Gauge ratio={ratio} className={tone} />
                </button>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-56">
                <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="text-xs font-medium">Context</span>
                    <span className={cn('text-xs font-medium tabular-nums', tone)}>{percent}%</span>
                </div>
                <div className="space-y-1">
                    <UsageRow label="Input" value={usage?.inputTokens ?? 0} />
                    <UsageRow label="Cached" value={usage?.cachedInputTokens ?? 0} />
                    <UsageRow label="Reasoning" value={usage?.reasoningTokens ?? 0} />
                    <UsageRow label="Output" value={usage?.outputTokens ?? 0} />
                    <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 text-xs">
                        <span className="text-muted-foreground">Total</span>
                        <span className="tabular-nums">
                            {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()}
                        </span>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    )
}
