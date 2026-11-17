import { Database } from '@/app/api/database.types'
import { isTemplateSubscription } from '@/ee/lib/billing/marketplace'
import { isLifetimeAddonsSubscription } from '@/ee/lib/billing/lifetime-addons'
import { stripe } from '@/ee/lib/billing/stripe'
import { isTrialCardReuseBlocked, ownsTrialClaim, TRIAL_BLOCKED_CARD_REUSE } from '@/ee/lib/billing/trial-card'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { checkoutPaymentMethodId, findWorkspaceId } from './billing.service'
import { reportTrialSkippedForCardReuse } from './billing-analytics.service'
import type Stripe from 'stripe'

type TrialCardInsert = Database['public']['Tables']['trial_card_fingerprints']['Insert']
type TrialCardUpdate = Database['public']['Tables']['trial_card_fingerprints']['Update']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

const CLAIM_COLUMNS = ['id', 'workspace_id', 'created_at'] as const

// One free trial per card, not per workspace. `workspaces.trial_ends_at` only ever gated the
// workspace it sits on, so a new signup was a new trial and a new Box: twelve of them in six days,
// two of which came from the very same card.
//
// The refusal only applies while isTrialCardReuseBlocked() says so. With it off, the card is still
// recorded and every trial goes through.
//
// A card that has already spent its trial gets the subscription cancelled, not billed. The trial is
// paid by a SetupIntent, so at this point nothing has been charged yet and cancelling costs the
// person nothing. Billing them instead was defensible on the fraud cluster and indefensible on the
// one person with one card and two workspaces, who clicked a button reading "Start free trial"
// under a line promising they would not be charged. That is a chargeback we would lose.
//
// Returns null when the trial was refused: there is no subscription left to sync, and the caller
// must not run applySubscriptionToWorkspace on it. That ordering matters more than it looks: a
// `trialing` sync would post the "your trial started" receipt (which lifecycle_emails then refuses
// to ever re-send), freeze trial_ends_at on a date a week out, and pin the budget to the trial cap.
//
// The workspace keeps `trial_ends_at`, so its next checkout carries no trial and the billing dialog
// already says so ("Your free trial has been used. Billed today, cancel anytime."). Subscribing for
// real stays one click away, this time with the price in front of them.
//
// Nothing here throws. The webhook event carries the workspace's whole entitlement, not just this
// check, so a hiccup on Stripe's side must not 500 into a retry loop and leave a paying customer
// locked out. The card simply stays unrecorded, and cloud/packages/cloud/scripts/audit-trial-card-reuse.ts records it
// cold afterwards.
export async function enforceTrialCardClaim(subscription: Stripe.Subscription, session?: Stripe.Checkout.Session): Promise<Stripe.Subscription | null> {
    try {
        if (subscription.status !== 'trialing' || isTemplateSubscription(subscription) || isLifetimeAddonsSubscription(subscription)) return subscription

        const workspaceId = await findWorkspaceId(subscription)
        if (!workspaceId) return subscription

        const paymentMethodId = await checkoutPaymentMethodId(session, subscription)
        if (!paymentMethodId) return subscription

        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
        const fingerprint = paymentMethod.card?.fingerprint
        if (!fingerprint) return subscription

        const supabase = createServiceRoleClient()
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

        await supabase.from('trial_card_fingerprints').upsert<TrialCardInsert>(
            {
                fingerprint,
                workspace_id: workspaceId,
                stripe_customer_id: customerId,
                stripe_subscription_id: subscription.id,
                payment_method_id: paymentMethodId,
            },
            { onConflict: 'fingerprint,workspace_id' },
        )

        if (!isTrialCardReuseBlocked()) return subscription

        // Read after writing, never before. Two checkouts on one card both find the table empty if
        // they look first, and both walk away with a trial; once both rows are in, they read the
        // same list and reach the same verdict.
        const { data: claims } = await selectMany(supabase, 'trial_card_fingerprints', CLAIM_COLUMNS, { fingerprint })
        if (ownsTrialClaim(claims ?? [], workspaceId)) return subscription

        // A webhook retry can land a day late with a payload frozen on `trialing`. Whatever the
        // subscription has become since, it is no longer ours to refuse, and cancelling one that is
        // already cancelled is an API error.
        const current = await stripe.subscriptions.retrieve(subscription.id)
        if (current.status !== 'trialing') return current

        const canceled = await stripe.subscriptions.cancel(
            subscription.id,
            { cancellation_details: { comment: TRIAL_BLOCKED_CARD_REUSE } },
            { idempotencyKey: `trial-card-block:${subscription.id}` },
        )

        const now = new Date().toISOString()
        await supabase
            .from('trial_card_fingerprints')
            .update<TrialCardUpdate>({ trial_skipped_at: now })
            .eq('fingerprint', fingerprint)
            .eq('workspace_id', workspaceId)
        // What makes the next checkout bill rather than offer a trial again, and picks the honest
        // copy in the billing dialog. Written here rather than left to the sync, which never runs on
        // this path, and which would have stamped the date the refused trial was meant to end.
        await supabase.from('workspaces').update<WorkspaceUpdate>({ trial_ends_at: now }).eq('id', workspaceId)
        await reportTrialSkippedForCardReuse(canceled, workspaceId)

        return null
    } catch (err) {
        console.error('[billing] trial card claim check failed', err)
        return subscription
    }
}
