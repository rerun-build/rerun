'use client'

import { useTranslations } from 'next-intl'
import type { LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type GroupTone = 'default' | 'warning' | 'danger'

const HEADING_TONE: Record<GroupTone, string> = {
    default: 'text-muted-foreground',
    warning: 'text-amber-500',
    danger: 'text-destructive',
}

export function CaptureReviewGroup({
    icon: Glyph,
    title,
    tone = 'default',
    children,
}: {
    icon: LucideIcon
    title: string
    tone?: GroupTone
    children: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
            <div className={cn('flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wide uppercase', HEADING_TONE[tone])}>
                <Glyph className="size-3.5 shrink-0" />
                {title}
            </div>
            {children}
        </div>
    )
}

// A row rather than a sentence: the labels line up down the card, so a reviewer scans the column
// instead of re-reading the same prose for every agent.
export function CaptureReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3 text-xs">
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
        </div>
    )
}

export function CaptureReviewChips({ items, mono = false, max = 8 }: { items: string[]; mono?: boolean; max?: number }) {
    const t = useTranslations('templates.capture.review')
    const shown = items.slice(0, max)
    const hidden = items.length - shown.length

    return (
        <>
            {shown.map(item => (
                <span
                    key={item}
                    className={cn('rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[0.7rem] text-foreground/80', mono && 'font-mono')}
                >
                    {item}
                </span>
            ))}
            {hidden > 0 && <span className="text-[0.7rem] text-muted-foreground">{t('more', { count: hidden })}</span>}
        </>
    )
}
