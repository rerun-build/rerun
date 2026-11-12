import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { memoryTables } from '@/ee/test/memory-table'
import { TEST_APPLE_VERIFIER_OPTIONS, signAppleJws } from '@/ee/test/apple-signing'
import { TEST_ACCOUNT_TOKEN, TEST_APPLE_CONFIG, appleNotification, appleRenewal, appleRenewalInfo, appleTransaction } from '@/ee/test/apple-payloads'

const m = vi.hoisted(() => ({
    createServiceRoleClient: vi.fn(),
    reconcileAgentActivation: vi.fn(),
    wakePlanLimitedAgents: vi.fn(),
    requestAgentActivationSync: vi.fn(),
    syncEnginePlan: vi.fn(),
    syncWorkspaceAppSlots: vi.fn(),
    reportStoreSubscriptionTransition: vi.fn(),
    requestBoxRestore: vi.fn(),
}))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('@/app/api/_services/agent-activation.service', () => ({ reconcileAgentActivation: m.reconcileAgentActivation, wakePlanLimitedAgents: m.wakePlanLimitedAgents }))
vi.mock('@/trigger/sync-agent-activation', () => ({ requestAgentActivationSync: m.requestAgentActivationSync }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ syncEnginePlan: m.syncEnginePlan }))
vi.mock('@/lib/apps/slots-sync', () => ({ syncWorkspaceAppSlots: m.syncWorkspaceAppSlots }))
vi.mock('./billing-analytics.service', () => ({ reportStoreSubscriptionTransition: m.reportStoreSubscriptionTransition }))
vi.mock('@rerun/cloud/engines', () => ({ requestBoxRestore: m.requestBoxRestore }))
// Rerun Cloud's answer, so the suite runs the same with and without cloud/.
vi.mock('@rerun/cloud/billing', () => ({ BILLING_ENABLED: true }))
// The production verifiers trust Apple's root; these trust the test chain the payloads are signed with.
vi.mock('@/ee/lib/billing/apple/verify', async importOriginal => {
    const actual = await importOriginal<typeof import('@/ee/lib/billing/apple/verify')>()
    const { TEST_APPLE_VERIFIER_OPTIONS: options } = await import('@/ee/test/apple-signing')
    return {
        ...actual,
        verifyAppleTransaction: (config: never, jws: string) => actual.verifyAppleTransaction(config, jws, options),
        verifyAppleRenewalInfo: (config: never, environment: never, jws: string) => actual.verifyAppleRenewalInfo(config, environment, jws, options),
    }
})

import { getStoreOffer, handleAppleNotification, recordStorePurchase, sweepStoreSubscriptions } from './store-billing.service'

const NOW = new Date('2026-11-12T10:00:00.000Z')
const DAY = 86_400_000

type Workspace = Record<string, unknown> & { id: number }

function workspace(id: number, overrides: Record<string, unknown> = {}): Workspace {
    return {
        id,
        current_period_end: null,
        subscription_status: null,
        first_paid_at: null,
        max_agents: 1,
        max_seats: 1,
        rerun_budget_micros: 3_500_000,
        billing_provider: null,
        store_subscription_id: null,
        store_account_token: null,
        store_environment: null,
        trial_ends_at: null,
        trial_started_at: null,
        is_sandbox: false,
        plan: 'base',
        stripe_subscription_id: null,
        payment_failed_at: null,
        ...overrides,
    }
}

let db: ReturnType<typeof memoryTables>

function useWorkspaces(...rows: Workspace[]) {
    db = memoryTables({ workspaces: { rows, unique: ['store_subscription_id', 'store_account_token'] } })
    m.createServiceRoleClient.mockReturnValue(db.client)
}

const row = (id: number) => db.tables.workspaces!.rows.find(candidate => candidate.id === id)!

function ctx(id: number, role: 'admin' | 'member' = 'admin'): WorkspaceContext {
    return { workspace: { id }, role, userId: 'user-1' } as unknown as WorkspaceContext
}

const purchase = (transaction: object) => ({ store: 'apple' as const, jws: signAppleJws(transaction) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APPLE_IAP_PRODUCT_ID', TEST_APPLE_CONFIG.productId)
    vi.stubEnv('APPLE_IAP_BUNDLE_ID', TEST_APPLE_CONFIG.bundleId)
    vi.stubEnv('APPLE_APP_APPLE_ID', String(TEST_APPLE_CONFIG.appAppleId))
    m.reconcileAgentActivation.mockResolvedValue([])
    m.wakePlanLimitedAgents.mockResolvedValue({ woken: ['agent-4'], active: [] })
})

describe('getStoreOffer', () => {
    it('offers the product with a token minted once and kept', async () => {
        useWorkspaces(workspace(1))
        const first = await getStoreOffer(ctx(1), 'apple')
        expect(first).toMatchObject({ available: true, provider: 'apple', productId: 'rerun.base.monthly', trialEligible: true })
        const token = (first as { accountToken: string }).accountToken
        expect(row(1).store_account_token).toBe(token)
        expect(await getStoreOffer(ctx(1), 'apple')).toMatchObject({ accountToken: token })
    })

    it('says the trial is spent once the workspace had one', async () => {
        useWorkspaces(workspace(1, { trial_ends_at: '2026-10-01T00:00:00.000Z', subscription_status: 'canceled' }))
        expect(await getStoreOffer(ctx(1), 'apple')).toMatchObject({ available: true, trialEligible: false })
    })

    it.each([
        ['a member', workspace(1), 'member', 'member'],
        ['a sandbox', workspace(1, { is_sandbox: true }), 'admin', 'sandbox'],
        ['a lifetime plan', workspace(1, { plan: 'lifetime' }), 'admin', 'lifetime_plan'],
        ['a Stripe plan in force', workspace(1, { billing_provider: 'stripe', subscription_status: 'active' }), 'admin', 'billed_on_web'],
        ['a cardless trial started by an older app', workspace(1, { billing_provider: 'stripe', subscription_status: 'trialing' }), 'admin', 'billed_on_web'],
        ['a plan in force without a provider (redeemed code)', workspace(1, { subscription_status: 'active' }), 'admin', 'billed_on_web'],
        ['an App Store subscription in force', workspace(1, { billing_provider: 'apple', subscription_status: 'trialing' }), 'admin', 'subscribed'],
        ['a Google Play subscription in force', workspace(1, { billing_provider: 'google', subscription_status: 'active' }), 'admin', 'other_store'],
    ] as const)('sells nothing to %s', async (_label, row, role, reason) => {
        useWorkspaces(row)
        expect(await getStoreOffer(ctx(1, role), 'apple')).toEqual({ available: false, reason })
    })

    it('sells again to a workspace whose Stripe plan has ended', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'stripe', subscription_status: 'canceled', trial_ends_at: '2026-10-01T00:00:00.000Z' }))
        expect(await getStoreOffer(ctx(1), 'apple')).toMatchObject({ available: true, trialEligible: false })
    })

    it('sells nothing when the App Store is not configured', async () => {
        vi.stubEnv('APPLE_IAP_PRODUCT_ID', '')
        useWorkspaces(workspace(1))
        expect(await getStoreOffer(ctx(1), 'apple')).toEqual({ available: false, reason: 'not_sold' })
    })

    it('sells nothing through Google Play before it is wired', async () => {
        useWorkspaces(workspace(1))
        expect(await getStoreOffer(ctx(1), 'google')).toEqual({ available: false, reason: 'not_sold' })
    })
})

describe('recordStorePurchase', () => {
    it('starts the trial on the workspace that bought it, with the same side effects as Stripe', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }))
        const result = await recordStorePurchase(ctx(1), purchase(appleTransaction({}, NOW.getTime())), NOW)

        expect(result).toEqual({ ok: true, entitled: true, status: 'trialing' })
        expect(row(1)).toMatchObject({
            billing_provider: 'apple',
            store_subscription_id: '2000000001',
            store_environment: 'Sandbox',
            subscription_status: 'trialing',
            trial_ends_at: new Date(NOW.getTime() + 7 * DAY).toISOString(),
            max_agents: 3,
            first_paid_at: null,
        })
        expect(m.requestAgentActivationSync).toHaveBeenCalled()
        expect(m.syncEnginePlan).toHaveBeenCalledWith(1)
        expect(m.requestBoxRestore).toHaveBeenCalledWith(1)
        expect(m.reportStoreSubscriptionTransition).toHaveBeenCalledWith(expect.objectContaining({ status: 'trialing' }), 1, null, false)
    })

    it('links a purchase carrying no token to the workspace that sent it', async () => {
        useWorkspaces(workspace(1))
        expect(await recordStorePurchase(ctx(1), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)).toMatchObject({ ok: true })
        expect(row(1).store_subscription_id).toBe('2000000001')
    })

    it('is idempotent: the same transaction sent twice changes nothing more', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }))
        const request = purchase(appleTransaction({}, NOW.getTime()))
        await recordStorePurchase(ctx(1), request, NOW)
        const before = { ...row(1) }
        expect(await recordStorePurchase(ctx(1), request, NOW)).toEqual({ ok: true, entitled: true, status: 'trialing' })
        expect(row(1)).toEqual(before)
    })

    it('refuses a subscription that already runs another workspace, which keeps it', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', subscription_status: 'trialing' }), workspace(2))
        expect(await recordStorePurchase(ctx(2), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'linked_elsewhere' })
        expect(row(2).store_subscription_id).toBeNull()
    })

    it('gives a purchase made with another workspace token to that workspace', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }), workspace(2))
        expect(await recordStorePurchase(ctx(2), purchase(appleTransaction({}, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'linked_elsewhere' })
        expect(row(1)).toMatchObject({ subscription_status: 'trialing', store_subscription_id: '2000000001' })
        expect(row(2).subscription_status).toBeNull()
    })

    it('refuses to bill a workspace a Stripe plan already bills', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'stripe', subscription_status: 'active', stripe_subscription_id: 'sub_1' }))
        expect(await recordStorePurchase(ctx(1), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'billed_on_web' })
        expect(row(1)).toMatchObject({ billing_provider: 'stripe', subscription_status: 'active' })
    })

    it('refuses a second App Store subscription on a workspace already running on one', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '1000000009', subscription_status: 'active' }))
        expect(await recordStorePurchase(ctx(1), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'other_store' })
    })

    it('refuses an App Store purchase on a workspace Google Play bills', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'google', store_subscription_id: 'google-token', subscription_status: 'active' }))
        expect(await recordStorePurchase(ctx(1), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'other_store' })
    })

    it('takes over a workspace whose Stripe plan has ended, and keeps its spent trial', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'stripe', subscription_status: 'canceled', trial_ends_at: '2026-10-01T00:00:00.000Z' }))
        const paid = appleTransaction({ appAccountToken: undefined, offerType: undefined, offerDiscountType: undefined, price: 29990, expiresDate: NOW.getTime() + 30 * DAY }, NOW.getTime())
        expect(await recordStorePurchase(ctx(1), purchase(paid), NOW)).toEqual({ ok: true, entitled: true, status: 'active' })
        expect(row(1)).toMatchObject({ billing_provider: 'apple', subscription_status: 'active', first_paid_at: NOW.toISOString(), trial_ends_at: '2026-10-01T00:00:00.000Z' })
    })

    it('answers expired to a restore of a lapsed subscription and links nothing', async () => {
        useWorkspaces(workspace(1))
        const lapsed = appleTransaction({ appAccountToken: undefined }, NOW.getTime() - 30 * DAY)
        expect(await recordStorePurchase(ctx(1), { ...purchase(lapsed), restore: true }, NOW)).toEqual({ ok: false, reason: 'expired' })
        expect(row(1).store_subscription_id).toBeNull()
    })

    it('rejects a transaction for a product the hub does not sell', async () => {
        useWorkspaces(workspace(1))
        await expect(recordStorePurchase(ctx(1), purchase(appleTransaction({ productId: 'rerun.other' }, NOW.getTime())), NOW)).rejects.toThrow(/unknown product/)
    })

    it('rejects a transaction that does not verify', async () => {
        useWorkspaces(workspace(1))
        await expect(recordStorePurchase(ctx(1), { store: 'apple', jws: 'a.b.c' }, NOW)).rejects.toThrow(/did not verify/)
    })

    it('answers not_sold when the App Store is not configured', async () => {
        vi.stubEnv('APPLE_APP_APPLE_ID', '')
        useWorkspaces(workspace(1))
        expect(await recordStorePurchase(ctx(1), purchase(appleTransaction({}, NOW.getTime())), NOW)).toEqual({ ok: false, reason: 'not_sold' })
    })

    it('answers linked_elsewhere when another workspace takes the subscription first', async () => {
        useWorkspaces(workspace(1), workspace(2, { store_subscription_id: '2000000001', billing_provider: 'apple', subscription_status: 'canceled' }))
        // The holder is found by id: simulate the race by hiding it from the read only.
        const holder = db.tables.workspaces!.rows[1]!
        db.tables.workspaces!.rows.splice(1, 1)
        const pending = recordStorePurchase(ctx(1), purchase(appleTransaction({ appAccountToken: undefined }, NOW.getTime())), NOW)
        db.tables.workspaces!.rows.push(holder)
        expect(await pending).toEqual({ ok: false, reason: 'linked_elsewhere' })
    })
})

describe('applyStoreSubscription', () => {
    const DAY_LATER = new Date(NOW.getTime() + 8 * DAY)

    it('converts a trial: wakes the coworkers the trial capped and stamps the payment', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', subscription_status: 'trialing', current_period_end: new Date(NOW.getTime() + 7 * DAY).toISOString(), max_agents: 3 }))
        const config = TEST_APPLE_CONFIG
        const notification = appleNotification('DID_RENEW', undefined, {
            signedTransactionInfo: signAppleJws(appleRenewal({}, NOW.getTime() + 7 * DAY)),
            signedRenewalInfo: signAppleJws(appleRenewalInfo({}, NOW.getTime())),
        })
        expect(await handleAppleNotification(config, notification as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)).toBe('applied')
        expect(row(1)).toMatchObject({ subscription_status: 'active', max_agents: null, first_paid_at: DAY_LATER.toISOString() })
        expect(m.wakePlanLimitedAgents).toHaveBeenCalledWith(1)
        expect(m.requestAgentActivationSync).toHaveBeenCalledWith(['agent-4'], { switchOn: true })
    })

    it('ends the right to run when the subscription expires, without a box restore', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', subscription_status: 'trialing' }))
        const notification = appleNotification('EXPIRED', 'VOLUNTARY', {
            signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime())),
            signedRenewalInfo: signAppleJws(appleRenewalInfo({ autoRenewStatus: 0 }, NOW.getTime())),
        })
        expect(await handleAppleNotification(TEST_APPLE_CONFIG, notification as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)).toBe('applied')
        expect(row(1).subscription_status).toBe('canceled')
        expect(m.requestBoxRestore).not.toHaveBeenCalled()
        expect(m.requestAgentActivationSync).toHaveBeenCalled()
    })

    it('finds the workspace by the token of the purchase when the notification comes first', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }))
        const notification = appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime())) })
        expect(await handleAppleNotification(TEST_APPLE_CONFIG, notification as never, NOW, TEST_APPLE_VERIFIER_OPTIONS)).toBe('applied')
        expect(row(1)).toMatchObject({ subscription_status: 'trialing', store_subscription_id: '2000000001' })
    })

    it('leaves alone a subscription no workspace of this hub holds', async () => {
        useWorkspaces(workspace(1))
        const notification = appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction({ appAccountToken: undefined }, NOW.getTime())) })
        expect(await handleAppleNotification(TEST_APPLE_CONFIG, notification as never, NOW, TEST_APPLE_VERIFIER_OPTIONS)).toBe('unknown')
        expect(row(1).subscription_status).toBeNull()
    })

    it('never overwrites a workspace a Stripe plan bills, even with its token', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN, billing_provider: 'stripe', subscription_status: 'active' }))
        const notification = appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime())) })
        expect(await handleAppleNotification(TEST_APPLE_CONFIG, notification as never, NOW, TEST_APPLE_VERIFIER_OPTIONS)).toBe('conflict')
        expect(row(1)).toMatchObject({ billing_provider: 'stripe', subscription_status: 'active' })
    })

    it('acknowledges a notification without a transaction (TEST)', async () => {
        useWorkspaces(workspace(1))
        expect(await handleAppleNotification(TEST_APPLE_CONFIG, appleNotification('TEST', undefined, {}) as never, NOW, TEST_APPLE_VERIFIER_OPTIONS)).toBe('ignored')
    })

    it('keeps the latest period when an older notification lands after it', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }))
        const renewed = appleNotification('DID_RENEW', undefined, { signedTransactionInfo: signAppleJws(appleRenewal({}, NOW.getTime() + 7 * DAY)) })
        const lateSubscribed = appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime())) })
        await handleAppleNotification(TEST_APPLE_CONFIG, renewed as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)
        expect(row(1).subscription_status).toBe('active')
        await handleAppleNotification(TEST_APPLE_CONFIG, lateSubscribed as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)
        expect(row(1)).toMatchObject({ subscription_status: 'active', current_period_end: new Date(NOW.getTime() + 37 * DAY).toISOString() })
    })

    it('still applies a refund of the period the workspace holds', async () => {
        useWorkspaces(workspace(1, { store_account_token: TEST_ACCOUNT_TOKEN }))
        await handleAppleNotification(TEST_APPLE_CONFIG, appleNotification('DID_RENEW', undefined, { signedTransactionInfo: signAppleJws(appleRenewal({}, NOW.getTime() + 7 * DAY)) }) as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)
        const refund = appleNotification('REFUND', undefined, { signedTransactionInfo: signAppleJws(appleRenewal({ revocationDate: DAY_LATER.getTime() }, NOW.getTime() + 7 * DAY)) })
        await handleAppleNotification(TEST_APPLE_CONFIG, refund as never, DAY_LATER, TEST_APPLE_VERIFIER_OPTIONS)
        expect(row(1).subscription_status).toBe('canceled')
    })
})

describe('sweepStoreSubscriptions', () => {
    beforeEach(() => {
        vi.stubEnv('APPLE_IAP_ISSUER_ID', 'issuer')
        vi.stubEnv('APPLE_IAP_KEY_ID', 'key')
        vi.stubEnv('APPLE_IAP_PRIVATE_KEY', 'pem')
    })

    it('reads the store again for the subscriptions whose period is over and applies what it says', async () => {
        const ended = new Date(NOW.getTime() - DAY).toISOString()
        useWorkspaces(
            workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', store_environment: 'Sandbox', subscription_status: 'trialing', current_period_end: ended }),
            workspace(2, { billing_provider: 'apple', store_subscription_id: '2000000002', store_environment: 'Sandbox', subscription_status: 'active', current_period_end: new Date(NOW.getTime() + 20 * DAY).toISOString() }),
            workspace(3, { billing_provider: 'stripe', subscription_status: 'active', current_period_end: ended }),
        )
        const fetchApple = vi.fn().mockResolvedValue({ signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime() - 8 * DAY)), signedRenewalInfo: signAppleJws(appleRenewalInfo({ autoRenewStatus: 0 }, NOW.getTime())) })

        expect(await sweepStoreSubscriptions(NOW, { fetchApple, verifierOptions: TEST_APPLE_VERIFIER_OPTIONS })).toEqual({ considered: 1, applied: 1, unchanged: 0, failed: [] })
        expect(fetchApple).toHaveBeenCalledWith(expect.objectContaining({ productId: 'rerun.base.monthly' }), expect.objectContaining({ keyId: 'key' }), '2000000001', 'Sandbox')
        expect(row(1).subscription_status).toBe('canceled')
    })

    it('writes nothing on a dry run, and skips without the In-App Purchase key', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', store_environment: 'Sandbox', subscription_status: 'trialing', current_period_end: NOW.toISOString() }))
        const fetchApple = vi.fn().mockResolvedValue({ signedTransactionInfo: signAppleJws(appleTransaction({}, NOW.getTime() - 8 * DAY)), signedRenewalInfo: null })
        expect(await sweepStoreSubscriptions(NOW, { fetchApple, dryRun: true, verifierOptions: TEST_APPLE_VERIFIER_OPTIONS })).toMatchObject({ considered: 1, applied: 0 })
        expect(row(1).subscription_status).toBe('trialing')

        vi.stubEnv('APPLE_IAP_PRIVATE_KEY', '')
        expect(await sweepStoreSubscriptions(NOW, { fetchApple })).toEqual({ considered: 0, applied: 0, unchanged: 0, failed: [] })
    })

    it('reports a workspace the store could not be read for and carries on', async () => {
        useWorkspaces(workspace(1, { billing_provider: 'apple', store_subscription_id: '2000000001', subscription_status: 'past_due', current_period_end: NOW.toISOString() }))
        const fetchApple = vi.fn().mockRejectedValue(new Error('Apple is down'))
        expect(await sweepStoreSubscriptions(NOW, { fetchApple })).toEqual({ considered: 1, applied: 0, unchanged: 0, failed: ['1: Apple is down'] })
    })
})
