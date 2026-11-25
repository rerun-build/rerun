'use client'

import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import { KindLegend } from '@/ee/components/dialogs/billing/credit-usage/parts'
import { UsageChart } from '@/ee/components/dialogs/billing/credit-usage/UsageChart'
import type { CreditBalance, CreditUsage } from '@/ee/lib/billing/credit-usage'

// The chart of the billing dialogs, on a workspace the reader is not in.
export function WorkspaceUsage({ balance, usage }: { balance: CreditBalance | null; usage: CreditUsage | null }) {
    const t = useTranslations('organization.usage')
    if (!balance || !usage)
        return (
            <div className="space-y-4 pt-2">
                <Skeleton className="mt-5 h-4 w-28" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-56 max-w-full" />
            </div>
        )
    if (usage.bySource.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
    return (
        <div className="space-y-4 pt-2">
            <UsageChart usage={usage} balance={balance} trial={false} resets={false} mode="daily" />
            <KindLegend balance={balance} />
        </div>
    )
}
