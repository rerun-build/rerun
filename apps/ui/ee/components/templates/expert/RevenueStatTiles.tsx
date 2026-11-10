'use client'

import { formatAmount } from '@rerun/contracts'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { CreatorRevenue } from '@/ee/services/creator-revenue.service'
import { cn } from '@/lib/utils'

export function RevenueStatTiles({ revenue }: { revenue: CreatorRevenue }) {
    const t = useTranslations('templates.revenue')
    const { totals, currency } = revenue

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label={t('sales')} value={String(totals.salesCount)} stripes />
                <Tile label={t('gross')} value={formatAmount(totals.grossCents, currency)} />
                <Tile label={t('fee')} value={formatAmount(totals.feeCents, currency)} />
                <Tile label={t('youEarned')} value={formatAmount(totals.netCents, currency)} />
            </div>

            {revenue.balance && (
                <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <BalanceRow label={t('pending')} value={formatAmount(revenue.balance.pendingCents, currency)} />
                    <BalanceRow label={t('available')} value={formatAmount(revenue.balance.availableCents, currency)} />
                    {revenue.activeSubscriptions > 0 && (
                        <BalanceRow
                            label={t('subscriptions', { count: revenue.activeSubscriptions })}
                            value={t('perMonth', { amount: formatAmount(revenue.mrrCents, currency) })}
                        />
                    )}
                </div>
            )}
        </div>
    )
}

function Tile({ label, value, stripes }: { label: string; value: string; stripes?: boolean }) {
    return (
        <div className={cn('relative overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-3', stripes && 'overflow-hidden')}>
            {stripes && <Stripes />}
            <p className="relative text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="relative mt-1 text-xl font-semibold tabular-nums">{value}</p>
        </div>
    )
}

function BalanceRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="whitespace-nowrap font-medium tabular-nums">{value}</span>
        </div>
    )
}
