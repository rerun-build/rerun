import { describe, expect, it } from 'vitest'
import { TEST_GOOGLE_ACCOUNT_TOKEN, TEST_GOOGLE_PRODUCT_ID, googlePaidPurchase, googlePurchase } from '@/ee/test/google-payloads'
import { googleSubscriptionState, needsAcknowledgement } from './state'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()
const read = (purchase: ReturnType<typeof googlePurchase>, now = NOW, options = {}) => googleSubscriptionState('token-1', purchase, TEST_GOOGLE_PRODUCT_ID, new Date(now), options)

describe('googleSubscriptionState', () => {
    it('reads the free week as a trial (SUBSCRIPTION_PURCHASED, offerPhase.freeTrial)', () => {
        expect(read(googlePurchase({}, {}, NOW))).toEqual({
            provider: 'google',
            subscriptionId: 'token-1',
            replacesSubscriptionId: null,
            accountToken: TEST_GOOGLE_ACCOUNT_TOKEN,
            environment: 'production',
            productId: TEST_GOOGLE_PRODUCT_ID,
            status: 'trialing',
            trialStartedAt: at(NOW),
            trialEndsAt: at(NOW + 7 * DAY),
            periodEnd: at(NOW + 7 * DAY),
            cancelAt: null,
            paid: false,
            revoked: false,
        })
    })

    it('reads the first paid month as active and paid (SUBSCRIPTION_RENEWED)', () => {
        expect(read(googlePaidPurchase({}, NOW + 7 * DAY), NOW + 8 * DAY)).toMatchObject({ status: 'active', paid: true, trialEndsAt: null, periodEnd: at(NOW + 37 * DAY) })
    })

    it('keeps access to the end of the period once auto-renewal is off (SUBSCRIPTION_CANCELED)', () => {
        const canceled = googlePurchase({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, { autoRenewingPlan: { autoRenewEnabled: false } }, NOW)
        expect(read(canceled, NOW + DAY)).toMatchObject({ status: 'trialing', cancelAt: at(NOW + 7 * DAY) })
        expect(read(canceled, NOW + 8 * DAY)).toMatchObject({ status: 'canceled', cancelAt: null })
    })

    it('reads the grace period and the account hold as past_due (SUBSCRIPTION_IN_GRACE_PERIOD, SUBSCRIPTION_ON_HOLD)', () => {
        expect(read(googlePaidPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }, NOW))?.status).toBe('past_due')
        expect(read(googlePaidPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }, NOW))?.status).toBe('past_due')
    })

    it('reads an expiry, and a pause that should never happen, as over (SUBSCRIPTION_EXPIRED, SUBSCRIPTION_PAUSED)', () => {
        expect(read(googlePaidPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, NOW - 40 * DAY))?.status).toBe('canceled')
        expect(read(googlePaidPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_PAUSED' }, NOW))?.status).toBe('canceled')
    })

    it('reads a refund as canceled and revoked (SUBSCRIPTION_REVOKED, voided purchase)', () => {
        expect(read(googlePaidPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, NOW), NOW, { revoked: true })).toMatchObject({ status: 'canceled', revoked: true, paid: false })
    })

    it('grants nothing while a payment is pending', () => {
        expect(read(googlePurchase({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }))).toBeNull()
        expect(read(googlePurchase({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED' }))).toBeNull()
    })

    it('names the purchase a re-signup replaces, and a test purchase', () => {
        expect(read(googlePaidPurchase({ linkedPurchaseToken: 'token-0', testPurchase: {} }, NOW))).toMatchObject({ replacesSubscriptionId: 'token-0', environment: 'test' })
    })
})

describe('needsAcknowledgement', () => {
    it('asks for the acknowledgement Google refunds a purchase without', () => {
        expect(needsAcknowledgement(googlePurchase())).toBe(true)
        expect(needsAcknowledgement(googlePaidPurchase())).toBe(false)
    })
})
