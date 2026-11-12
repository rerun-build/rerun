import type { JWSRenewalInfoDecodedPayload, JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import type { StoreSubscriptionState, StoreSubscriptionStatus } from '@/ee/lib/billing/store/subscription-state'

// Apple's own enums, spelled as the payload carries them so this file stays a pure function of data.
const FREE_TRIAL = 'FREE_TRIAL'
const AUTO_RENEW_OFF = 0

function iso(ms: number | undefined): string | null {
    return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// A failed renewal keeps the subscription for as long as Apple retries it, billing grace period
// included: the hub calls that `past_due`, the way it calls Stripe's retries. Once Apple stops,
// the subscription has expired.
function lapsedStatus(renewal: JWSRenewalInfoDecodedPayload | null, now: Date): StoreSubscriptionStatus {
    if (renewal?.isInBillingRetryPeriod) return 'past_due'
    if (renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now.getTime()) return 'past_due'
    return 'canceled'
}

// The state of an auto-renewable subscription from its latest transaction and its renewal info,
// whichever notification or purchase brought them: the reading is the same for a SUBSCRIBED, a
// DID_RENEW, an EXPIRED or a restore, which is what makes a replay or an out-of-order delivery
// harmless.
//
// The free week is the introductory offer: its transaction carries `offerDiscountType: FREE_TRIAL`
// and a price of zero, and the renewal that follows is the first paid period.
export function appleSubscriptionState(transaction: JWSTransactionDecodedPayload, renewal: JWSRenewalInfoDecodedPayload | null, environment: string, now: Date): StoreSubscriptionState {
    const subscriptionId = transaction.originalTransactionId ?? transaction.transactionId
    if (!subscriptionId) throw new Error('Apple transaction without an id')

    const expires = transaction.expiresDate ?? 0
    const running = expires > now.getTime() && !transaction.revocationDate
    const inTrial = transaction.offerDiscountType === FREE_TRIAL
    const status: StoreSubscriptionStatus = transaction.revocationDate ? 'canceled' : running ? (inTrial ? 'trialing' : 'active') : lapsedStatus(renewal, now)
    const periodEnd = iso(transaction.expiresDate)

    return {
        provider: 'apple',
        subscriptionId,
        accountToken: transaction.appAccountToken ?? renewal?.appAccountToken ?? null,
        environment,
        productId: transaction.productId ?? '',
        status,
        trialStartedAt: inTrial ? iso(transaction.purchaseDate) : null,
        trialEndsAt: inTrial ? periodEnd : null,
        periodEnd,
        cancelAt: running && renewal?.autoRenewStatus === AUTO_RENEW_OFF ? periodEnd : null,
        paid: !inTrial && (transaction.price ?? 1) > 0 && !transaction.revocationDate,
        revoked: !!transaction.revocationDate,
    }
}
