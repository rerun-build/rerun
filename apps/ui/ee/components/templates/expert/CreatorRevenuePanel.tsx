'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { RevenueRange } from '@/ee/services/creator-revenue.service'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ExternalLinkIcon, WalletIcon } from '@/lib/icons'
import { useCreatorStore } from '@/stores/creator.store'
import { cn } from '@/lib/utils'
import { CreatorRevenuePanelSkeleton } from './CreatorRevenuePanelSkeleton'
import { RevenueChart } from './RevenueChart'
import { RevenueSalesTable } from './RevenueSalesTable'
import { RevenueStatTiles } from './RevenueStatTiles'
import { useCreatorPayouts } from './useCreatorPayouts'
import { useCreatorRevenue } from './useCreatorRevenue'

const RANGES: RevenueRange[] = ['30d', '12m', 'all']

// What Rerun can answer that Stripe cannot: revenue per template. Everything else, payout history
// included, is one login link away in the Express dashboard.
export function CreatorRevenuePanel({ active }: { active: boolean }) {
    const t = useTranslations('templates.revenue')
    const { revenue, range, changeRange } = useCreatorRevenue(active)
    const { account, pending, openDashboard } = useCreatorPayouts(active)
    const setPane = useCreatorStore(state => state.setPane)

    if (account !== null && account.state === 'not_started') {
        return (
            <EmptyState
                icon={WalletIcon}
                title={t('noAccountTitle')}
                description={t('noAccountDescription')}
                action={
                    <Button type="button" size="sm" onClick={() => setPane({ kind: 'payouts' })}>
                        {t('setUpPayouts')}
                    </Button>
                }
            />
        )
    }

    if (revenue === null) return <CreatorRevenuePanelSkeleton />

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <h3 className="text-base font-medium">{t('title')}</h3>
                <div className="flex items-center gap-1">
                    {RANGES.map(option => (
                        <Button
                            key={option}
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-pressed={range === option}
                            onClick={() => changeRange(option)}
                            className={cn('text-xs', range === option && 'bg-accent text-foreground')}
                        >
                            {t(`ranges.${option}`)}
                        </Button>
                    ))}
                </div>
            </div>

            <ScrollFade className="min-h-0 flex-1 px-5 pb-5">
                <div className="flex flex-col gap-5 pt-5">
                    <RevenueStatTiles revenue={revenue} />
                    <RevenueChart revenue={revenue} />
                    <RevenueSalesTable revenue={revenue} />

                    <div className="flex">
                        <Button type="button" size="sm" variant="outline" loading={pending === 'dashboard'} onClick={openDashboard}>
                            <ExternalLinkIcon className="size-3.5" />
                            {t('openDashboard')}
                        </Button>
                    </div>
                </div>
            </ScrollFade>
        </div>
    )
}
