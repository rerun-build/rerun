'use client'

import { Badge } from '@rerun/ui/primitives'
import type { PaidSourceLine, PaidTurnSources } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { createElement } from 'react'

import { SourceFacepile, SourceLogo } from '@/components/data/sources/SourceLogo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { paidDataIcon } from '@/lib/paid-data/spend'
import { ShieldCheckIcon } from '@/lib/icons'

function SourceLineRow({ line }: { line: PaidSourceLine }) {
    const t = useTranslations('tools')
    return (
        <div className="flex items-center gap-2.5 py-1.5">
            <SourceLogo source={line.source} size="md" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{line.source.name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {createElement(paidDataIcon(line.capability), { className: 'size-3 shrink-0' })}
                    {t(`paidData.${line.capability}`)}
                </p>
            </div>
            <div className="w-24 shrink-0 text-right">
                <p className="text-sm text-foreground tabular-nums">
                    {line.found}
                    <span className="text-muted-foreground">/{line.asked}</span>
                </p>
                <p className="text-[11px] leading-tight text-muted-foreground">{line.label}</p>
            </div>
        </div>
    )
}

// Under the reply of a turn that bought paid data: who it came from, and what each source gave.
export function PaidSourcesPill({ sources }: { sources: PaidTurnSources }) {
    const t = useTranslations('chat.paidSources')
    const { emails } = sources
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="mb-4 flex min-h-8 w-fit items-center gap-2 rounded-full border border-border bg-background py-1 pr-3 pl-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                >
                    <SourceFacepile sources={sources.sources} max={4} />
                    {t('count', { count: sources.sources.length })}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2 p-3">
                <div className="flex max-h-[min(360px,60vh)] flex-col divide-y divide-border overflow-y-auto">
                    {sources.lines.map(line => (
                        <SourceLineRow key={`${line.source.id}|${line.capability}`} line={line} />
                    ))}
                </div>
                {emails.checked > 0 && (
                    <div className="border-t border-border pt-2">
                        <Badge size="xs" tone={emails.valid === emails.checked ? 'green' : 'neutral'} glow={false} leading={<ShieldCheckIcon className="size-3" />}>
                            {t('emailsVerified', { valid: emails.valid, checked: emails.checked })}
                        </Badge>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
