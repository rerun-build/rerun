'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { RocketIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBillingStore } from '@/stores/billing.store'
import { useSession } from '@/supabase/session/SessionProvider'

const DAY_MS = 86_400_000

function trialDaysLeftLabel(t: ReturnType<typeof useTranslations<'billing'>>, trialEndsAt: string, now: number): string | null {
    const remaining = new Date(trialEndsAt).getTime() - now
    if (remaining <= 0) return null
    return remaining < DAY_MS ? t('layout.pill.underADayLeft') : t('layout.pill.daysLeft', { count: Math.ceil(remaining / DAY_MS) })
}

/**
 * Beside the workspace pill until the workspace is on a paid plan. The billing dialog it opens
 * already knows the way out of each state: a trial to start, a card to add, a trial to convert,
 * a failed invoice to fix.
 */
export function UpgradePill() {
    const t = useTranslations('billing')
    const { workspace, isAnonymous } = useSession()
    const status = workspace?.subscription_status ?? null
    const trialEndsAt = status === 'trialing' ? (workspace?.trial_ends_at ?? null) : null
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!trialEndsAt) return
        const id = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(id)
    }, [trialEndsAt])

    if (!workspace || isAnonymous || workspace.is_sandbox || status === 'active') return null

    const pastDue = status === 'past_due'
    const daysLeft = trialEndsAt ? trialDaysLeftLabel(t, trialEndsAt, now) : null

    return <UpgradePillButton pastDue={pastDue} daysLeft={daysLeft} onClick={() => useBillingStore.getState().openBilling(undefined, 'upgrade_pill')} />
}

export function UpgradePillButton({ pastDue, daysLeft, onClick }: { pastDue: boolean; daysLeft: string | null; onClick?: () => void }) {
    const t = useTranslations('billing')
    return (
        <Button onClick={onClick} className="h-(--chrome-size) gap-2 rounded-full pr-[15px] pl-[11px]">
            <RocketIcon className={cn('size-4', pastDue && 'text-destructive')} />
            {pastDue ? t('layout.pill.updatePayment') : daysLeft ? t('layout.pill.freeTrial') : t('layout.pill.upgrade')}
            {daysLeft && <span className="text-primary-foreground/60 tabular-nums max-sm:hidden">· {daysLeft}</span>}
        </Button>
    )
}
