'use client'

import { marketplaceFeeLabel } from '@rerun/contracts'
import { ScrollFade, Stripes } from '@rerun/ui/primitives'
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useCreatorStore } from '@/stores/creator.store'
import { CreatorPayoutsPanelSkeleton } from './CreatorPayoutsPanelSkeleton'
import { PayoutStatusCard } from './PayoutStatusCard'
import { useCreatorPayouts } from './useCreatorPayouts'

// Payouts live inside the creator panel rather than in a page of their own: getting paid and
// pricing a template are the same job, one click apart.
export function CreatorPayoutsPanel({ active }: { active: boolean }) {
    const t = useTranslations('templates.payouts')
    const { account, pending, reload, startOnboarding, openDashboard } = useCreatorPayouts(active)
    const connectRefresh = useCreatorStore(state => state.connectRefresh)
    const setConnectRefresh = useCreatorStore(state => state.setConnectRefresh)

    // Stripe sends the user back here when the onboarding link died on the way. Minting a fresh one
    // straight away is its documented handling, so the user never sees a dead end.
    React.useEffect(() => {
        if (!active || !connectRefresh) return
        setConnectRefresh(false)
        toast(t('expired'))
        void startOnboarding()
    }, [active, connectRefresh, setConnectRefresh, startOnboarding, t])

    if (account === null) return <CreatorPayoutsPanelSkeleton />

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-1 px-5 pt-5">
                <h3 className="text-base font-medium">{t('title')}</h3>
                <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
            </div>

            <ScrollFade className="min-h-0 flex-1 px-5 pb-5">
                <div className="flex flex-col gap-5 pt-5">
                    <PayoutStatusCard account={account} pending={pending} onStartOnboarding={startOnboarding} onOpenDashboard={openDashboard} onReload={reload} />

                    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-3">
                        <Stripes />
                        <HowRow label={t('yourPrice')} value={t('yourPriceValue')} />
                        <HowRow label={t('commission')} value={marketplaceFeeLabel()} />
                        <HowRow label={t('schedule')} value={t('scheduleValue')} />
                    </div>

                    <p className="text-xs text-muted-foreground">
                        {t('planNote')}
                    </p>
                </div>
            </ScrollFade>
        </div>
    )
}

function HowRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="relative flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="whitespace-nowrap font-medium">{value}</span>
        </div>
    )
}
