'use client'

import type { PendingHitlSummary } from '@/lib/chat/hitl-cue'
import { ArrowDownIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

// The scroll-to-bottom arrow grown into what the coworker is waiting for, down the thread.
export function PendingHitlPill({ summary, onJump }: { summary: PendingHitlSummary; onJump: () => void }) {
    const t = useTranslations('chat.pendingHitl')
    const KindIcon = summary.icon
    return (
        <button type="button" onClick={onJump} aria-label={t('goTo', { label: summary.label })} className="inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-border bg-background pr-3 pl-1.5 text-sm font-medium text-foreground shadow-md transition-colors hover:bg-muted">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', summary.tone)}>
                <KindIcon className="size-3.5" />
            </span>
            <span className="truncate">{summary.label}</span>
            <ArrowDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
    )
}
