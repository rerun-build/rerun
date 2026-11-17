import type Stripe from 'stripe'
import { ZERO_QUANTITIES } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { subscriptionPeriodEndIso } from '@/ee/lib/billing/marketplace'
import { hasPeriodAdvanced } from '@/ee/lib/billing/period'
import { quantitiesFromItems } from '@/ee/lib/billing/stripe'
import { syncWorkspaceAppSlots } from '@/lib/apps/slots-sync'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { findWorkspaceId } from './billing.service'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

// The slots of a lifetime workspace, from the subscription that carries nothing but them. The plan,
// its status and its limits are never touched: the machine of a lifetime workspace does not depend on
// what it pays for its slots.
//
// `adopt` is true for a purchase (Checkout completed, subscription created), false for the lifecycle
// events of a subscription that must already be the workspace's own.
export async function applyLifetimeAddonsSubscription(subscription: Stripe.Subscription, { adopt }: { adopt: boolean }): Promise<void> {
    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return

    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_addons_subscription_id', 'addons_current_period_end'] as const, { id: workspaceId })
    if (!workspace) return
    if (!adopt && workspace.stripe_addons_subscription_id !== subscription.id) {
        console.warn(`[billing] ignoring add-ons subscription ${subscription.id} for workspace ${workspaceId}, which holds ${workspace.stripe_addons_subscription_id}`)
        return
    }

    // A subscription that is over gives every slot back at once: there is no paid period left to hold.
    const live = isSubscriptionEntitled(subscription.status)
    const periodEnd = subscriptionPeriodEndIso(subscription)
    const periodAdvanced = !live || hasPeriodAdvanced(workspace.addons_current_period_end, periodEnd)

    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ stripe_addons_subscription_id: subscription.id, addons_current_period_end: periodEnd })
        .eq('id', workspaceId)
    if (error) throw error

    const { quantities } = quantitiesFromItems(subscription.items?.data ?? [])
    await syncWorkspaceAppSlots(supabase, workspaceId, live ? quantities : ZERO_QUANTITIES, { periodAdvanced })
}
