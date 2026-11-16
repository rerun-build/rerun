import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendLifetimeCodeEmail } from '@/app/api/_services/email.service'
import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'
import { createLifetimeCheckoutUrl, deliverLifetimeCheckout, lifetimeCodeForCheckout, lifetimeCodeOf } from './lifetime-deal.service'

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: (await import('@/ee/test/stripe-fake')).fakeStripe() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/email.service', () => ({ sendLifetimeCodeEmail: vi.fn() }))
vi.mock('@/lib/i18n/request-locale', () => ({ requestLocale: vi.fn().mockResolvedValue('fr') }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://app.rerun.test') }))
vi.mock('@/ee/lib/billing/affiliate', () => ({ affiliateReferralMetadata: vi.fn().mockResolvedValue({ affonso_referral: 'ref_1' }) }))

const SESSION = { id: 'cs_test_1', metadata: { kind: 'lifetime_deal', locale: 'fr' }, payment_status: 'paid', customer_details: { email: 'ada@acme.com' } }

let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    db = fakeSupabase()
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(sendLifetimeCodeEmail).mockResolvedValue({ ok: true, id: 'em_1' })
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue(SESSION as never)
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' } as never)
})

describe('lifetimeCodeOf', () => {
    it('gives one stable, readable code per session', () => {
        const code = lifetimeCodeOf('cs_test_1')
        expect(code).toMatch(/^RERUN-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
        expect(lifetimeCodeOf('cs_test_1')).toBe(code)
        expect(lifetimeCodeOf('cs_test_2')).not.toBe(code)
    })
})

describe('createLifetimeCheckoutUrl', () => {
    it('sells the lifetime price once, credits the affiliate, keeps the buyer language and comes back to /redeem', async () => {
        await expect(createLifetimeCheckoutUrl()).resolves.toBe('https://checkout.stripe.test/cs_1')
        expect(vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]).toMatchObject({
            mode: 'payment',
            line_items: [{ price: 'price_lifetime', quantity: 1 }],
            metadata: { kind: 'lifetime_deal', locale: 'fr', affonso_referral: 'ref_1' },
            payment_intent_data: { metadata: { kind: 'lifetime_deal', locale: 'fr', affonso_referral: 'ref_1' } },
            success_url: 'https://app.rerun.test/redeem?session_id={CHECKOUT_SESSION_ID}',
        })
    })
})

describe('lifetimeCodeForCheckout', () => {
    it('saves a one-use lifetime code tied to its Checkout Session, and leaves the email to the webhook', async () => {
        const code = await lifetimeCodeForCheckout('cs_test_1')
        expect(code).toBe(lifetimeCodeOf('cs_test_1'))
        expect(db.writes('invitation_codes')).toEqual([
            expect.objectContaining({ method: 'upsert', payload: { code, plan: 'lifetime', max_uses: 1, note: 'Bought on rerun.build by ada@acme.com (cs_test_1)', created_by: 'stripe' } }),
        ])
        expect(db.chainsOn('invitation_codes')[0]).toContainEqual(expect.objectContaining({ method: 'upsert', args: [expect.anything(), { onConflict: 'code', ignoreDuplicates: true }] }))
        expect(sendLifetimeCodeEmail).not.toHaveBeenCalled()
    })

    it('shows no code for a session that is not paid', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ ...SESSION, payment_status: 'unpaid' } as never)
        await expect(lifetimeCodeForCheckout('cs_test_1')).resolves.toBeNull()
        expect(db.writes('invitation_codes')).toEqual([])
    })

    it('shows no code for a session that sold something else', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ ...SESSION, metadata: { kind: 'credit_purchase' } } as never)
        await expect(lifetimeCodeForCheckout('cs_test_1')).resolves.toBeNull()
    })

    it('shows no code for an id that is not a Checkout Session', async () => {
        await expect(lifetimeCodeForCheckout('pi_123')).resolves.toBeNull()
        expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    })

    it('shows no code for a session Stripe does not know', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockRejectedValue(Object.assign(new Error('No such checkout session'), { code: 'resource_missing' }))
        await expect(lifetimeCodeForCheckout('cs_test_404')).resolves.toBeNull()
    })
})

describe('deliverLifetimeCheckout', () => {
    it('saves the code and emails it in the language the buyer checked out in', async () => {
        await deliverLifetimeCheckout(SESSION as never)
        const code = lifetimeCodeOf('cs_test_1')
        expect(db.writes('invitation_codes')).toEqual([expect.objectContaining({ method: 'upsert', payload: expect.objectContaining({ code }) })])
        expect(sendLifetimeCodeEmail).toHaveBeenCalledExactlyOnceWith({ to: 'ada@acme.com', code, locale: 'fr' })
    })

    it('falls back to the default language when the session carries none it knows', async () => {
        await deliverLifetimeCheckout({ ...SESSION, metadata: { kind: 'lifetime_deal', locale: 'xx' } } as never)
        expect(sendLifetimeCodeEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: undefined }))
    })

    it('throws when the email fails, so Stripe delivers the event again', async () => {
        vi.mocked(sendLifetimeCodeEmail).mockResolvedValue({ ok: false, error: 'resend down' })
        await expect(deliverLifetimeCheckout(SESSION as never)).rejects.toThrow('resend down')
    })

    it('does nothing for a session that is not paid', async () => {
        await deliverLifetimeCheckout({ ...SESSION, payment_status: 'unpaid' } as never)
        expect(db.writes('invitation_codes')).toEqual([])
        expect(sendLifetimeCodeEmail).not.toHaveBeenCalled()
    })

    it('still saves the code of a session without an email', async () => {
        await deliverLifetimeCheckout({ ...SESSION, customer_details: null } as never)
        expect(db.writes('invitation_codes')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ note: 'Bought on rerun.build (cs_test_1)' }) })])
        expect(sendLifetimeCodeEmail).not.toHaveBeenCalled()
    })
})
