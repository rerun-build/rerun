import type { JWSRenewalInfoDecodedPayload, JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import { describe, expect, it } from 'vitest'
import { appleRenewal, appleRenewalInfo, appleTransaction } from '@/ee/test/apple-payloads'
import { appleSubscriptionState } from './state'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

const transaction = (overrides: Record<string, unknown> = {}, start = NOW) => appleTransaction(overrides, start) as JWSTransactionDecodedPayload
const renewal = (overrides: Record<string, unknown> = {}, start = NOW) => appleRenewal(overrides, start) as JWSTransactionDecodedPayload
const info = (overrides: Record<string, unknown> = {}) => appleRenewalInfo(overrides, NOW) as JWSRenewalInfoDecodedPayload
const read = (tx: JWSTransactionDecodedPayload, renewalInfo: JWSRenewalInfoDecodedPayload | null = info(), now = NOW) => appleSubscriptionState(tx, renewalInfo, 'Sandbox', new Date(now))

describe('appleSubscriptionState', () => {
    it('reads the free week as a trial ending with the transaction (SUBSCRIBED/INITIAL_BUY, FREE_TRIAL)', () => {
        expect(read(transaction())).toEqual({
            provider: 'apple',
            subscriptionId: '2000000001',
            accountToken: '7d7c1c5e-8b8b-4b5e-9d47-0f9a4b0c2a11',
            environment: 'Sandbox',
            productId: 'rerun.base.monthly',
            status: 'trialing',
            trialStartedAt: at(NOW),
            trialEndsAt: at(NOW + 7 * DAY),
            periodEnd: at(NOW + 7 * DAY),
            cancelAt: null,
            paid: false,
            revoked: false,
        })
    })

    it('reads the first paid month as active and paid (DID_RENEW)', () => {
        const state = read(renewal({}, NOW), info(), NOW + DAY)
        expect(state).toMatchObject({ status: 'active', paid: true, trialStartedAt: null, trialEndsAt: null, periodEnd: at(NOW + 30 * DAY) })
    })

    it('reads a purchase without a trial as active and paid (SUBSCRIBED/RESUBSCRIBE)', () => {
        expect(read(transaction({ offerType: undefined, offerDiscountType: undefined, price: 29990 }))).toMatchObject({ status: 'active', paid: true, trialEndsAt: null })
    })

    it('sets the end of access when auto-renewal is switched off (DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED)', () => {
        expect(read(transaction(), info({ autoRenewStatus: 0 }))).toMatchObject({ status: 'trialing', cancelAt: at(NOW + 7 * DAY) })
    })

    it('clears it once auto-renewal is back on (AUTO_RENEW_ENABLED)', () => {
        expect(read(transaction(), info({ autoRenewStatus: 1 })).cancelAt).toBeNull()
    })

    it('reads a failed renewal Apple is still retrying as past_due (DID_FAIL_TO_RENEW)', () => {
        expect(read(transaction(), info({ isInBillingRetryPeriod: true }), NOW + 8 * DAY)).toMatchObject({ status: 'past_due', paid: false })
    })

    it('reads a billing grace period as past_due (DID_FAIL_TO_RENEW/GRACE_PERIOD)', () => {
        expect(read(renewal(), info({ gracePeriodExpiresDate: NOW + 35 * DAY }), NOW + 31 * DAY).status).toBe('past_due')
    })

    it('reads a lapsed subscription as canceled (EXPIRED, GRACE_PERIOD_EXPIRED)', () => {
        expect(read(transaction(), info({ autoRenewStatus: 0 }), NOW + 8 * DAY)).toMatchObject({ status: 'canceled', cancelAt: null })
        expect(read(renewal(), info({ gracePeriodExpiresDate: NOW + 31 * DAY }), NOW + 40 * DAY).status).toBe('canceled')
    })

    it('reads a refund as canceled and revoked, never as paid (REFUND, REVOKE)', () => {
        expect(read(renewal({ revocationDate: NOW + DAY, revocationReason: 0 }), info(), NOW + 2 * DAY)).toMatchObject({ status: 'canceled', revoked: true, paid: false })
    })

    it('reads without the renewal info, as a purchase sent by the app arrives', () => {
        expect(read(transaction(), null)).toMatchObject({ status: 'trialing', cancelAt: null })
        expect(read(transaction(), null, NOW + 8 * DAY).status).toBe('canceled')
    })

    it('falls back on the renewal info for the account token', () => {
        expect(read(transaction({ appAccountToken: undefined }), info({ appAccountToken: 'abc' })).accountToken).toBe('abc')
        expect(read(transaction({ appAccountToken: undefined }), null).accountToken).toBeNull()
    })
})
