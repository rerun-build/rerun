import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'
import { ensureStripeCustomer } from './billing.service'
import { requirePayoutReadyAccount } from './connect.service'
import { confirmTemplateCheckoutSession, createTemplateCheckoutSession, NO_PLAN_ERROR } from './template-checkout.service'
import { recordTemplatePurchase } from './template-purchase.service'

vi.mock('@rerun/cloud/marketplace', async () => (await import('@/test/cloud-fakes')).CLOUD_MARKETPLACE)
vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: (await import('@/ee/test/stripe-fake')).fakeStripe() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = vi.fn()
    return { getServerSession: session, getSessionWorkspace: session }
})
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceId: vi.fn() }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://app.rerun.test') }))
vi.mock('./billing.service', () => ({ ensureStripeCustomer: vi.fn() }))
vi.mock('./connect.service', () => ({ requirePayoutReadyAccount: vi.fn() }))
vi.mock('./template-purchase.service', () => ({ recordTemplatePurchase: vi.fn() }))

const WORKSPACE_ID = 42

type Template = { id: string; slug: string; title: string; status: string; creator_id: string | null; pricing_model: string; price_amount_cents: number; price_currency: string; stripe_price_id: string | null }

let template: Template | null
let purchase: { status: string } | null
let subscriptionStatus: string | null
let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    template = { id: 'tpl_1', slug: 'seo-team', title: 'SEO team', status: 'published', creator_id: 'creator_1', pricing_model: 'one_time', price_amount_cents: 1900, price_currency: 'usd', stripe_price_id: 'price_tpl' }
    purchase = null
    subscriptionStatus = 'active'
    db = fakeSupabase(table => {
        if (table === 'templates') return { data: template }
        if (table === 'template_purchases') return { data: purchase }
        if (table === 'workspaces') return { data: { subscription_status: subscriptionStatus } }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(requireWorkspaceId).mockResolvedValue(WORKSPACE_ID)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'buyer_1' } } as never)
    vi.mocked(requirePayoutReadyAccount).mockResolvedValue('acct_1')
    vi.mocked(ensureStripeCustomer).mockResolvedValue({ customerId: 'cus_1' } as never)
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' } as never)
})

describe('createTemplateCheckoutSession', () => {
    it('refuses a template that is not public', async () => {
        template!.status = 'draft'
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow('This template is not available.')
    })

    it('refuses a template that does not exist', async () => {
        template = null
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow('This template is not available.')
    })

    it('answers free for a free template without opening a checkout', async () => {
        template!.pricing_model = 'free'
        await expect(createTemplateCheckoutSession('seo-team')).resolves.toEqual({ kind: 'free' })
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it('answers owned to the template author', async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'creator_1' } } as never)
        await expect(createTemplateCheckoutSession('seo-team')).resolves.toEqual({ kind: 'owned' })
    })

    it('answers owned when the workspace already holds the template', async () => {
        purchase = { status: 'active' }
        await expect(createTemplateCheckoutSession('seo-team')).resolves.toEqual({ kind: 'owned' })
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it.each([['past_due'], ['canceled'], [null]])('refuses a workspace whose plan is %s', async status => {
        subscriptionStatus = status
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow(NO_PLAN_ERROR)
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    })

    it('lets a trialing workspace buy', async () => {
        subscriptionStatus = 'trialing'
        await expect(createTemplateCheckoutSession('seo-team')).resolves.toEqual({ kind: 'checkout', url: 'https://checkout.stripe.test/cs_1' })
    })

    it('refuses a template to a past_due workspace while it keeps the rest of its plan', async () => {
        subscriptionStatus = 'past_due'
        expect(isSubscriptionEntitled('past_due')).toBe(true)
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow(NO_PLAN_ERROR)
    })

    it('refuses a paid template without a Stripe price', async () => {
        template!.stripe_price_id = null
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow('This template is not available for purchase yet.')
    })

    it('opens a one-off payment that saves the card and carries the metadata on the payment intent', async () => {
        await createTemplateCheckoutSession('seo-team')

        const params = vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]!
        const metadata = { kind: 'template_purchase', workspace_id: '42', template_id: 'tpl_1', template_slug: 'seo-team', creator_id: 'creator_1', connected_account_id: 'acct_1' }
        expect(params).toMatchObject({
            mode: 'payment',
            customer: 'cus_1',
            client_reference_id: 'buyer_1',
            line_items: [{ price: 'price_tpl', quantity: 1 }],
            payment_method_types: ['card'],
            payment_intent_data: { metadata, setup_future_usage: 'on_session' },
            metadata,
            success_url: 'https://app.rerun.test/?template=seo-team&purchase=success&session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://app.rerun.test/?template=seo-team&purchase=cancel',
        })
        expect(params).not.toHaveProperty('subscription_data')
        expect(params).not.toHaveProperty('transfer_data')
        expect(requirePayoutReadyAccount).toHaveBeenCalledWith('creator_1')
    })

    it('opens a subscription that carries the metadata on the subscription', async () => {
        template!.pricing_model = 'recurring'

        await createTemplateCheckoutSession('seo-team')

        const params = vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]!
        expect(params).toMatchObject({ mode: 'subscription', payment_method_types: ['card'], subscription_data: { metadata: expect.objectContaining({ template_id: 'tpl_1', workspace_id: '42' }) } })
        expect(params).not.toHaveProperty('payment_intent_data')
    })

    it('throws when Stripe returns no checkout URL', async () => {
        vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: null } as never)
        await expect(createTemplateCheckoutSession('seo-team')).rejects.toThrow('Stripe did not return a checkout URL')
    })
})

describe('confirmTemplateCheckoutSession', () => {
    it('refuses a session from another workspace', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ status: 'complete', metadata: { workspace_id: '7' } } as never)
        await expect(confirmTemplateCheckoutSession('cs_1')).rejects.toThrow('This purchase belongs to another workspace.')
        expect(recordTemplatePurchase).not.toHaveBeenCalled()
    })

    it('grants nothing while the session is not complete', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ status: 'open', metadata: { workspace_id: '42' } } as never)
        await expect(confirmTemplateCheckoutSession('cs_1')).resolves.toEqual({ entitled: false })
        expect(recordTemplatePurchase).not.toHaveBeenCalled()
    })

    it('records the purchase of a completed session', async () => {
        const session = { status: 'complete', payment_status: 'paid', metadata: { workspace_id: '42' } }
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue(session as never)
        await expect(confirmTemplateCheckoutSession('cs_1')).resolves.toEqual({ entitled: true })
        expect(recordTemplatePurchase).toHaveBeenCalledWith(session)
    })

    it("withholds the template while a complete session's payment_status is still 'unpaid'", async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ status: 'complete', payment_status: 'unpaid', metadata: { workspace_id: '42' } } as never)
        await expect(confirmTemplateCheckoutSession('cs_1')).resolves.toEqual({ entitled: false })
        expect(recordTemplatePurchase).not.toHaveBeenCalled()
    })
})
