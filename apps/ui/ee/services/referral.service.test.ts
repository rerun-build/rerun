import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REFERRAL_FRIENDS_SHOWN, REFERRAL_MONTHS_CAP } from '@/ee/lib/billing/referral'
import { stripe } from '@/ee/lib/billing/stripe'
import { attachReferral } from '@/ee/services/referral-attach.service'
import { fakeSupabase, writeMethodOf, type SupabaseResolver } from '@/test/supabase-fake'

import { ensureReferralCode, getReferralOverview, rewardReferral } from './referral.service'

const m = vi.hoisted(() => ({
    createServiceRoleClient: vi.fn(),
    paidPlanInvoiceWorkspace: vi.fn(),
    getUserById: vi.fn(),
}))

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()),
    stripe: (await import('@/ee/test/stripe-fake')).fakeStripe(),
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('@/ee/services/billing.service', () => ({ paidPlanInvoiceWorkspace: m.paidPlanInvoiceWorkspace }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: async () => 'https://app.rerun.build' }))

const REFEREE_WS = 20
const REFERRER_WS = 10
const REFERRAL = { id: 'ref_1', referrer_workspace_id: REFERRER_WS, referee_credit_cents: null, referrer_credit_cents: null }
const invoice = { id: 'in_1', customer: 'cus_referee', amount_paid: 2900 } as Stripe.Invoice
const subscriptionOn = (price: string, customer: string, id = `sub_${customer}`, status = 'active') => ({ id, status, customer, items: { data: [{ price: { id: price, recurring: { interval: 'month' } } }] } })

function withDb(resolve: SupabaseResolver) {
    const fake = fakeSupabase(resolve)
    m.createServiceRoleClient.mockReturnValue(Object.assign(fake.client, { auth: { admin: { getUserById: m.getUserById } } }))
    return fake
}

function rewardDb({ referral = REFERRAL as object | null, earned = 0, referrerSubscription = 'sub_referrer' as string | null }: { referral?: object | null; earned?: number; referrerSubscription?: string | null } = {}) {
    return withDb((table, calls) => {
        if (table === 'workspaces') return { data: { stripe_subscription_id: referrerSubscription } }
        if (table !== 'referrals') return undefined
        if (writeMethodOf(calls)) return { error: null }
        if (calls.some(call => call.method === 'maybeSingle')) return { data: referral }
        return { data: Array.from({ length: earned }, (_, index) => ({ id: `earned_${index}` })) }
    })
}

const credit = () => vi.mocked(stripe.invoiceItems.create)
const recorded = (db: ReturnType<typeof rewardDb>) => db.writes('referrals').map(write => write.payload)

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('STRIPE_PRICE_BASE', 'price_base_49')
    vi.stubEnv('STRIPE_PRICE_BASE_29', 'price_base_29')
    m.paidPlanInvoiceWorkspace.mockResolvedValue({ workspaceId: REFEREE_WS, subscription: subscriptionOn('price_base_29', 'cus_referee') })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscriptionOn('price_base_29', 'cus_referrer', 'sub_referrer') as never)
    m.getUserById.mockResolvedValue({ data: { user: { id: 'user-referrer', email: 'clement@example.com', user_metadata: { full_name: 'Clément Janssens' }, app_metadata: {} } } })
})

afterEach(() => vi.unstubAllEnvs())

describe('rewardReferral', () => {
    it('does nothing for an invoice that is not a real charge for a plan', async () => {
        const db = rewardDb()
        m.paidPlanInvoiceWorkspace.mockResolvedValue(null)

        await rewardReferral(invoice)

        expect(db.writes('referrals')).toEqual([])
        expect(credit()).not.toHaveBeenCalled()
    })

    it('does nothing when the workspace was not referred or was already rewarded', async () => {
        rewardDb({ referral: null })

        await rewardReferral(invoice)

        expect(credit()).not.toHaveBeenCalled()
    })

    it('takes a month off the next plan invoice of the friend and of the referrer, and records each side', async () => {
        const db = rewardDb()

        await rewardReferral(invoice)

        expect(credit()).toHaveBeenCalledTimes(2)
        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referee', subscription: 'sub_cus_referee', amount: -2900, currency: 'usd' }), { idempotencyKey: 'referral-ref_1-referee' })
        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referrer', subscription: 'sub_referrer', amount: -2900, currency: 'usd' }), { idempotencyKey: 'referral-ref_1-referrer' })
        expect(recorded(db)).toEqual([{ referee_credit_cents: 2900 }, { referrer_credit_cents: 2900 }, { rewarded_at: expect.any(String) }])
    })

    it('still gives the friend a month once the referrer reached the cap, and records 0 for the referrer', async () => {
        const db = rewardDb({ earned: REFERRAL_MONTHS_CAP })

        await rewardReferral(invoice)

        expect(credit()).toHaveBeenCalledTimes(1)
        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referee' }), { idempotencyKey: 'referral-ref_1-referee' })
        expect(recorded(db)).toContainEqual({ referrer_credit_cents: 0 })
    })

    it('records 0 for a referrer whose plan ended', async () => {
        const db = rewardDb({ referrerSubscription: null })

        await rewardReferral(invoice)

        expect(credit()).toHaveBeenCalledTimes(1)
        expect(recorded(db)).toContainEqual({ referrer_credit_cents: 0 })
    })

    it('credits each side a month at the price its own subscription is billed', async () => {
        const db = rewardDb()
        m.paidPlanInvoiceWorkspace.mockResolvedValue({ workspaceId: REFEREE_WS, subscription: subscriptionOn('price_base_49', 'cus_referee') })

        await rewardReferral(invoice)

        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referee', amount: -4900 }), expect.anything())
        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referrer', amount: -2900 }), expect.anything())
        expect(recorded(db).slice(0, 2)).toEqual([{ referee_credit_cents: 4900 }, { referrer_credit_cents: 2900 }])
    })

    it('keeps the friend side when the referrer side fails, and leaves the referral unrewarded', async () => {
        const db = rewardDb()
        credit().mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('stripe down'))

        await expect(rewardReferral(invoice)).rejects.toThrow('stripe down')

        expect(recorded(db)).toEqual([{ referee_credit_cents: 2900 }])
    })

    it('on a retry, only pays the side that is left', async () => {
        const db = rewardDb({ referral: { ...REFERRAL, referee_credit_cents: 2900 } })

        await rewardReferral(invoice)

        expect(credit()).toHaveBeenCalledTimes(1)
        expect(credit()).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_referrer' }), { idempotencyKey: 'referral-ref_1-referrer' })
        expect(recorded(db)).toEqual([{ referrer_credit_cents: 2900 }, { rewarded_at: expect.any(String) }])
    })
})

describe('attachReferral', () => {
    function attachDb(owner: object | null) {
        return withDb((table, calls) => {
            if (table === 'referral_codes') return { data: owner }
            if (table === 'referrals' && writeMethodOf(calls)) return { error: null }
            return undefined
        })
    }

    it('makes the new account the friend of the code owner, once', async () => {
        const db = attachDb({ code: 'clement', workspace_id: REFERRER_WS, user_id: 'user-referrer' })

        await attachReferral('user-friend', REFEREE_WS, 'clement')

        const [write] = db.writes('referrals')
        expect(write.method).toBe('upsert')
        expect(write.payload).toEqual({ code: 'clement', referrer_workspace_id: REFERRER_WS, referrer_user_id: 'user-referrer', referee_user_id: 'user-friend', referee_workspace_id: REFEREE_WS })
        expect(db.chainsOn('referrals')[0].find(call => call.method === 'upsert')?.args[1]).toEqual({ onConflict: 'referee_user_id', ignoreDuplicates: true })
    })

    it('ignores an unknown code, a malformed one and the owner own link', async () => {
        const unknown = attachDb(null)
        await attachReferral('user-friend', REFEREE_WS, 'nobody')
        expect(unknown.writes('referrals')).toEqual([])

        const malformed = attachDb({ code: 'x', workspace_id: REFERRER_WS, user_id: 'user-referrer' })
        await attachReferral('user-friend', REFEREE_WS, '../admin')
        expect(malformed.calls).toEqual([])

        const own = attachDb({ code: 'clement', workspace_id: REFERRER_WS, user_id: 'user-referrer' })
        await attachReferral('user-referrer', REFEREE_WS, 'clement')
        expect(own.writes('referrals')).toEqual([])
    })
})

describe('ensureReferralCode', () => {
    const user = { id: 'user-referrer', email: 'clement@example.com', user_metadata: { full_name: 'Clément Janssens' }, app_metadata: {} }

    it('keeps the code a member already has', async () => {
        const db = withDb(table => (table === 'referral_codes' ? { data: { code: 'clement' } } : undefined))
        expect(await ensureReferralCode(REFERRER_WS, user)).toBe('clement')
        expect(db.writes('referral_codes')).toEqual([])
    })

    it('reads the code off the first name, and adds a number when it is taken', async () => {
        let inserts = 0
        const db = withDb((table, calls) => {
            if (table !== 'referral_codes') return undefined
            if (!writeMethodOf(calls)) return { data: null }
            inserts++
            return inserts === 1 ? { error: { code: '23505' } } : { error: null }
        })

        const code = await ensureReferralCode(REFERRER_WS, user)

        const written = db.writes('referral_codes').map(write => (write.payload as { code: string }).code)
        expect(written[0]).toBe('clement')
        expect(code).toMatch(/^clement-\d{4}$/)
        expect(written[1]).toBe(code)
    })
})

describe('getReferralOverview', () => {
    it('lists the friends with their status and counts the months the referrer earned', async () => {
        withDb(table => {
            if (table === 'referral_codes') return { data: { code: 'clement' } }
            if (table === 'referrals')
                return {
                    data: [
                        { id: 'r1', referee_user_id: 'u1', referee_workspace_id: 1, rewarded_at: '2026-11-12T00:00:00Z', referrer_credit_cents: 2900 },
                        { id: 'r2', referee_user_id: 'u2', referee_workspace_id: 2, rewarded_at: null, referrer_credit_cents: null },
                        { id: 'r3', referee_user_id: 'u3', referee_workspace_id: 3, rewarded_at: null, referrer_credit_cents: null },
                        { id: 'r4', referee_user_id: 'u4', referee_workspace_id: 4, rewarded_at: '2026-11-13T00:00:00Z', referrer_credit_cents: 0 },
                    ],
                }
            if (table === 'workspaces')
                return {
                    data: [
                        { id: 1, subscription_status: 'active', trial_ends_at: '2026-11-10T00:00:00Z' },
                        { id: 2, subscription_status: 'trialing', trial_ends_at: '2026-11-24T00:00:00Z' },
                        { id: 3, subscription_status: 'canceled', trial_ends_at: '2026-11-01T00:00:00Z' },
                        { id: 4, subscription_status: 'active', trial_ends_at: '2026-11-08T00:00:00Z' },
                    ],
                }
            return undefined
        })
        m.getUserById.mockImplementation(async (id: string) => ({ data: { user: { id, email: `${id}@example.com`, user_metadata: { full_name: `Friend ${id}` }, app_metadata: {} } } }))

        const overview = await getReferralOverview(REFERRER_WS, { id: 'user-referrer', user_metadata: {}, app_metadata: {} })

        expect(overview.link).toBe('https://app.rerun.build/i/clement')
        expect(overview.monthsEarned).toBe(1)
        expect(overview.cap).toBe(REFERRAL_MONTHS_CAP)
        expect(overview.moreFriends).toBe(0)
        expect(overview.friends.map(friend => [friend.name, friend.status])).toEqual([
            ['Friend u1', 'subscribed'],
            ['Friend u4', 'subscribed'],
            ['Friend u2', 'trial'],
            ['Friend u3', 'canceled'],
        ])
    })

    it('reads the identity of the friends it shows only, and counts the others', async () => {
        const rows = Array.from({ length: REFERRAL_FRIENDS_SHOWN + 2 }, (_, index) => ({ id: `r${index}`, referee_user_id: `u${index}`, referee_workspace_id: index, rewarded_at: null, referrer_credit_cents: null }))
        withDb(table => {
            if (table === 'referral_codes') return { data: { code: 'clement' } }
            if (table === 'referrals') return { data: rows }
            if (table === 'workspaces') return { data: [] }
            return undefined
        })
        m.getUserById.mockImplementation(async (id: string) => ({ data: { user: { id, email: `${id}@example.com`, user_metadata: {}, app_metadata: {} } } }))

        const overview = await getReferralOverview(REFERRER_WS, { id: 'user-referrer', user_metadata: {}, app_metadata: {} })

        expect(overview.friends).toHaveLength(REFERRAL_FRIENDS_SHOWN)
        expect(overview.moreFriends).toBe(2)
        expect(m.getUserById).toHaveBeenCalledTimes(REFERRAL_FRIENDS_SHOWN)
    })
})
