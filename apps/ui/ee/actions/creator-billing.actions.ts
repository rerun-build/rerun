'use server'

import { requireExpertUserId } from '@/app/api/_auth/expert'
import {
    createCreatorDashboardLink,
    createCreatorOnboardingLink,
    refreshCreatorAccount,
    type CreatorAccountState,
} from '@/ee/services/connect.service'
import { getCreatorRevenue, type CreatorRevenue, type RevenueRange } from '@/ee/services/creator-revenue.service'

import type { ActionResult } from '@/app/api/_actions/space.actions'
import { failureOf } from '@/lib/i18n/action-error'

// Payouts and revenue are the creator's own money: every action here resolves the caller and reads
// nothing from the client. There is no id to pass, which is the point.

export async function getCreatorAccountAction(): Promise<ActionResult<{ account: CreatorAccountState }>> {
    try {
        const userId = await requireExpertUserId()
        return { ok: true, account: await refreshCreatorAccount(userId) }
    } catch (err) {
        return failureOf(err, 'loadPayoutsAccountFailed')
    }
}

export async function startCreatorOnboardingAction(): Promise<ActionResult<{ url: string }>> {
    try {
        const userId = await requireExpertUserId()
        return { ok: true, url: await createCreatorOnboardingLink(userId) }
    } catch (err) {
        return failureOf(err, 'openStripeOnboardingFailed')
    }
}

export async function openCreatorDashboardAction(): Promise<ActionResult<{ url: string }>> {
    try {
        const userId = await requireExpertUserId()
        return { ok: true, url: await createCreatorDashboardLink(userId) }
    } catch (err) {
        return failureOf(err, 'openStripeDashboardFailed')
    }
}

export async function getCreatorRevenueAction(range: RevenueRange): Promise<ActionResult<{ revenue: CreatorRevenue }>> {
    try {
        const userId = await requireExpertUserId()
        return { ok: true, revenue: await getCreatorRevenue(userId, range) }
    } catch (err) {
        return failureOf(err, 'loadRevenueFailed')
    }
}
