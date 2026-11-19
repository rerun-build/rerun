import { getTranslations } from 'next-intl/server'

import type { Referrer } from '@/ee/services/referral-attach.service'

// Above the sign-in buttons of a visitor who came through a friend's referral link.
export async function ReferralInvite({ referrer }: { referrer: Referrer }) {
    const t = await getTranslations('auth.page.referral')
    return (
        <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-border">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-medium text-brand uppercase">
                {referrer.firstName?.slice(0, 1) ?? '+'}
            </span>
            <div className="min-w-0">
                <p className="truncate text-sm font-medium">{referrer.firstName ? t('invited', { name: referrer.firstName }) : t('invitedByFriend')}</p>
                <p className="text-xs text-muted-foreground">{t('secondMonthFree')}</p>
            </div>
        </div>
    )
}
