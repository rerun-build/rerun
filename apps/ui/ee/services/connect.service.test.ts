import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { markCreatorAccountDeauthorized, syncCreatorAccount } from './connect.service'

vi.mock('@/ee/lib/billing/stripe', async importOriginal => {
    const fake = (await import('@/ee/test/stripe-fake')).fakeStripe()
    return { ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: { ...fake, accounts: { ...fake.accounts, update: vi.fn() } } }
})
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = vi.fn()
    return { getServerSession: session, getSessionWorkspace: session }
})
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: vi.fn() }))

const accountsUpdate = (stripe.accounts as unknown as { update: ReturnType<typeof vi.fn> }).update

let existing: { user_id: string; onboarded_at: string | null } | null
let db: FakeSupabase

function account(overrides: Record<string, unknown> = {}): Stripe.Account {
    return {
        id: 'acct_1',
        charges_enabled: false,
        payouts_enabled: true,
        details_submitted: true,
        capabilities: { transfers: 'active' },
        requirements: { disabled_reason: null, currently_due: ['external_account'], past_due: ['individual.dob'] },
        country: 'FR',
        default_currency: 'eur',
        ...overrides,
    } as unknown as Stripe.Account
}

beforeEach(() => {
    vi.clearAllMocks()
    existing = { user_id: 'user_1', onboarded_at: null }
    db = fakeSupabase((table, calls) => (table === 'creator_accounts' && !writeMethodOf(calls) ? { data: existing } : undefined))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
})

describe('syncCreatorAccount', () => {
    it('ignores an account that is not ours', async () => {
        existing = null
        await syncCreatorAccount(account())
        expect(db.writes('creator_accounts')).toEqual([])
    })

    it('mirrors the account and stamps the onboarding the first time details are submitted', async () => {
        await syncCreatorAccount(account())

        const [update] = db.writes('creator_accounts')
        expect(update.payload).toEqual({
            charges_enabled: false,
            payouts_enabled: true,
            details_submitted: true,
            disabled_reason: null,
            requirements_due: ['external_account', 'individual.dob'],
            country: 'FR',
            default_currency: 'eur',
            updated_at: expect.any(String),
            onboarded_at: expect.any(String),
        })
        expect(update.filters.map(call => call.args)).toEqual([['stripe_account_id', 'acct_1']])
    })

    it('keeps the first onboarding date on a later sync', async () => {
        existing = { user_id: 'user_1', onboarded_at: '2026-09-01T00:00:00Z' }
        await syncCreatorAccount(account())
        expect(db.writes('creator_accounts')[0].payload).not.toHaveProperty('onboarded_at')
    })

    it('stamps no onboarding while details are still missing', async () => {
        await syncCreatorAccount(account({ details_submitted: false }))
        expect(db.writes('creator_accounts')[0].payload).not.toHaveProperty('onboarded_at')
        expect(accountsUpdate).not.toHaveBeenCalled()
    })

    it('requests the transfers capability once details are in and syncs what Stripe answers', async () => {
        accountsUpdate.mockResolvedValue(account({ capabilities: { transfers: 'pending' }, payouts_enabled: false }))

        await syncCreatorAccount(account({ capabilities: {} }))

        expect(accountsUpdate).toHaveBeenCalledWith('acct_1', { capabilities: { transfers: { requested: true } } })
        expect(db.writes('creator_accounts')[0].payload).toMatchObject({ payouts_enabled: false })
    })
})

describe('markCreatorAccountDeauthorized', () => {
    it('does nothing without an account id', async () => {
        await markCreatorAccountDeauthorized(undefined)
        expect(db.calls).toHaveLength(0)
    })

    it('switches the account off', async () => {
        await markCreatorAccountDeauthorized('acct_1')

        const [update] = db.writes('creator_accounts')
        expect(update.payload).toEqual({ charges_enabled: false, payouts_enabled: false, disabled_reason: 'deauthorized', updated_at: expect.any(String) })
        expect(update.filters.map(call => call.args)).toEqual([['stripe_account_id', 'acct_1']])
    })
})
