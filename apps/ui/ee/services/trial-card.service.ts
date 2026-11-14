import { Database } from '@/app/api/database.types'
import { isTemplateSubscription } from '@/ee/lib/billing/marketplace'
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

export async function enforceTrialCardClaim(subscription: Stripe.Subscription, session?: Stripe.Checkout.Session): Promise<Stripe.Subscription | null> {
    try {
        if (subscription.status !== 'trialing' || isTemplateSubscription(subscription)) return subscription

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

        const { data: claims } = await selectMany(supabase, 'trial_card_fingerprints', CLAIM_COLUMNS, { fingerprint })
        if (ownsTrialClaim(claims ?? [], workspaceId)) return subscription

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
        await supabase.from('workspaces').update<WorkspaceUpdate>({ trial_ends_at: now }).eq('id', workspaceId)
        await reportTrialSkippedForCardReuse(canceled, workspaceId)

        return null
    } catch (err) {
        console.error('[billing] trial card claim check failed', err)
        return subscription
    }
}
