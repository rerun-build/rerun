'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { formatCredits } from '@/ee/lib/billing/plans'
import { ChevronRightIcon, CoinsIcon, Receipt, type LucideIcon } from '@/lib/icons'

// One line of the billing overview that opens something: its icon and label on the left, what it
// holds on the right.
export function OverviewLinkRow({ icon: RowIcon, label, value, onOpen }: { icon: LucideIcon; label: string; value: ReactNode; onOpen: () => void }) {
    return (
        <button type="button" onClick={onOpen} className="flex items-center justify-between gap-3 rounded-xl bg-background/60 px-4 py-3 text-sm ring-1 ring-border hover:bg-background">
            <span className="flex shrink-0 items-center gap-3">
                <RowIcon className="size-4 text-muted-foreground" />
                {label}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground">{value}</span>
        </button>
    )
}

export function InvoicesRow({ onOpen }: { onOpen: () => void }) {
    const t = useTranslations('billing.plan.overview')
    return <OverviewLinkRow icon={Receipt} label={t('invoices')} value={<span className="underline underline-offset-4">{t('viewAll')}</span>} onOpen={onOpen} />
}

export function CreditUsageRow({ leftMicros, onOpen }: { leftMicros: number | null; onOpen: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing.plan.overview')
    return (
        <OverviewLinkRow
            icon={CoinsIcon}
            label={t('creditUsage')}
            value={
                <>
                    {leftMicros != null && <span className="tabular-nums">{t('creditsLeft', { credits: formatCredits(leftMicros, locale) })}</span>}
                    <ChevronRightIcon className="size-4" />
                </>
            }
            onOpen={onOpen}
        />
    )
}
