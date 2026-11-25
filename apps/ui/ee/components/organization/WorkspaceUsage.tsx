'use client'

import { useTranslations } from 'next-intl'

import { PANEL_CARD } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import type { CreditBalance, CreditUsage } from '@/ee/lib/billing/credit-usage'
import { KindLegend } from '@/ee/components/dialogs/billing/credit-usage/parts'
import { UsageChart } from '@/ee/components/dialogs/billing/credit-usage/UsageChart'
import { cn } from '@/lib/utils'

// The chart of the billing dialogs, on a workspace the reader is not in.
export function WorkspaceUsage({ balance, usage }: { balance: CreditBalance | null; usage: CreditUsage | null }) {
    const t = useTranslations('organization.usage')
    return (
        <div className={cn('space-y-4 p-4', PANEL_CARD)}>
            {!balance || !usage ? (
                <>
                    <Skeleton className="mt-5 h-4 w-28" />
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-4 w-56 max-w-full" />
                </>
            ) : usage.bySource.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
                <>
                    <UsageChart usage={usage} balance={balance} trial={false} resets={false} mode="daily" />
                    <KindLegend balance={balance} />
                </>
            )}
        </div>
    )
}
