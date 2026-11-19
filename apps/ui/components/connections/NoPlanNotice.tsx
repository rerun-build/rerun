'use client'

import { useTranslations } from 'next-intl'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { isSubscriptionEntitled, trialOffer } from '@moldwright/cloud/billing'
import { startPlan } from '@moldwright/cloud/billing.client'
import { cn } from '@/lib/utils'
import { useSession } from '@/supabase/session/SessionProvider'

export function useNeedsPlanToConnect(): boolean {
    const { workspace } = useSession()
    return !!workspace && !isSubscriptionEntitled(workspace.subscription_status)
}

export function NoPlanNotice({ className }: { className?: string }) {
    const t = useTranslations('connections.noPlan')
    const { workspace } = useSession()
    const trialEligible = trialOffer(workspace) !== 'paid'
    const [pending, startTransition] = useTransition()

    return (
        <div className={cn('flex flex-col gap-3 rounded-md border border-dashed px-3 py-4 sm:flex-row sm:items-center', className)}>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {trialEligible ? t('trialText') : t('subscribeText')}
            </p>
            <Button size="sm" className="shrink-0 self-start sm:self-auto" disabled={pending} onClick={() => startTransition(() => startPlan('ai_providers'))}>
                {trialEligible ? t('startTrial') : t('subscribe')}
            </Button>
        </div>
    )
}
