import { isPublicStatus, type TemplateStatus } from '@rerun/contracts'
import type Stripe from 'stripe'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { getAppOrigin } from '@/lib/app-origin'
import { TEMPLATE_PURCHASE_CONSENT } from '@/ee/lib/billing/consent'
import { TEMPLATE_PURCHASE_KIND } from '@/ee/lib/billing/marketplace'
import { stripe } from '@/ee/lib/billing/stripe'
import { hasTemplateEntitlement } from '@/lib/templates/entitlement'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'
import { ensureStripeCustomer } from './billing.service'
import { requirePayoutReadyAccount } from './connect.service'
import { recordTemplatePurchase } from './template-purchase.service'

export const NO_PLAN_ERROR = 'no_active_plan'

export type TemplateCheckoutOutcome = { kind: 'checkout'; url: string } | { kind: 'owned' } | { kind: 'free' }

const CHECKOUT_COLUMNS = ['id', 'slug', 'title', 'status', 'creator_id', 'pricing_model', 'price_amount_cents', 'price_currency', 'stripe_price_id'] as const

export async function createTemplateCheckoutSession(slug: string): Promise<TemplateCheckoutOutcome> {
    const workspaceId = await requireWorkspaceId()
    const { user } = await getServerSession()
    const supabase = createServiceRoleClient()

    const { data: template } = await selectMaybeSingle(supabase, 'templates', CHECKOUT_COLUMNS, { slug })
    if (!template || !isPublicStatus(template.status as TemplateStatus)) throw new AppError('templateUnavailable')

    if (template.pricing_model === 'free') return { kind: 'free' }
    if (template.creator_id && template.creator_id === user?.id) return { kind: 'owned' }
    if (await hasTemplateEntitlement(supabase, workspaceId, template, user?.id)) return { kind: 'owned' }

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspaceId })
    const status = workspace?.subscription_status
    if (status !== 'active' && status !== 'trialing') throw new Error(NO_PLAN_ERROR)

    if (!template.stripe_price_id) throw new AppError('templateNotPurchasableYet')
    const destination = await requirePayoutReadyAccount(template.creator_id)

    const { customerId } = await ensureStripeCustomer()
    const recurring = template.pricing_model === 'recurring'
    const origin = await getAppOrigin()

    const metadata: Stripe.MetadataParam = {
        kind: TEMPLATE_PURCHASE_KIND,
        workspace_id: String(workspaceId),
        template_id: template.id,
        template_slug: template.slug,
        creator_id: template.creator_id ?? '',
        connected_account_id: destination,
    }

    const checkout = await stripe.checkout.sessions.create({
        mode: recurring ? 'subscription' : 'payment',
        customer: customerId,
        client_reference_id: user?.id ?? undefined,
        line_items: [{ price: template.stripe_price_id, quantity: 1 }],
        payment_method_types: ['card'],
        ...(recurring ? { subscription_data: { metadata } } : { payment_intent_data: { metadata, setup_future_usage: 'on_session' as const } }),
        saved_payment_method_options: { allow_redisplay_filters: ['always', 'limited', 'unspecified'] },
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        ...TEMPLATE_PURCHASE_CONSENT,
        metadata,
        success_url: `${origin}/?template=${template.slug}&purchase=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?template=${template.slug}&purchase=cancel`,
    })

    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    return { kind: 'checkout', url: checkout.url }
}

export async function confirmTemplateCheckoutSession(sessionId: string): Promise<{ entitled: boolean }> {
    const workspaceId = await requireWorkspaceId()
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.metadata?.workspace_id !== String(workspaceId)) throw new AppError('purchaseOtherWorkspace')
    if (session.status !== 'complete' || session.payment_status !== 'paid') return { entitled: false }

    await recordTemplatePurchase(session)
    return { entitled: true }
}
