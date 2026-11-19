'use server'

import { requireAdminContext } from '@/app/api/_auth/ownership'
import type { ReferralOverview } from '@/ee/lib/billing/referral'
import { pendingReferrer, type Referrer } from '@/ee/services/referral-attach.service'
import { getReferralOverview } from '@/ee/services/referral.service'
import { failureOf, type ActionFailure } from '@/lib/i18n/action-error'

// The link, the months earned and the friends of the member who opens Refer a friend.
export async function getReferralOverviewAction(): Promise<{ ok: true; overview: ReferralOverview } | ActionFailure> {
    try {
        const { workspace, authUser } = await requireAdminContext('adminOnlyBilling')
        return { ok: true, overview: await getReferralOverview(workspace.id, authUser) }
    } catch (err) {
        return failureOf(err, 'loadReferralsFailed')
    }
}

// Whoever invited this workspace, while its free month is still to come. null when nobody did.
export async function getPendingReferrerAction(): Promise<{ ok: true; referrer: Referrer | null } | ActionFailure> {
    try {
        const { workspace } = await requireAdminContext('adminOnlyBilling')
        return { ok: true, referrer: await pendingReferrer(workspace.id) }
    } catch (err) {
        return failureOf(err, 'loadReferralsFailed')
    }
}
