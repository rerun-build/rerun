import type { androidpublisher_v3 } from '@googleapis/androidpublisher'
import type { StoreSubscriptionState, StoreSubscriptionStatus } from '@/ee/lib/billing/store/subscription-state'

export type GoogleSubscriptionPurchase = androidpublisher_v3.Schema$SubscriptionPurchaseV2

// The RTDN notificationType of a subscription revoked by a refund (SUBSCRIPTION_REVOKED).
export const GOOGLE_SUBSCRIPTION_REVOKED = 12

function laterStatus(state: string | null | undefined, running: boolean, inTrial: boolean): StoreSubscriptionStatus | null {
    switch (state) {
        case 'SUBSCRIPTION_STATE_ACTIVE':
            return inTrial ? 'trialing' : 'active'
        // Auto-renewal switched off: access runs to the expiry time, then the subscription expires.
        case 'SUBSCRIPTION_STATE_CANCELED':
            return running ? (inTrial ? 'trialing' : 'active') : 'canceled'
        // Google retries the payment: the grace period keeps access, the hold takes it away, and the
        // hub reads both as past_due, the way it reads Stripe's retries. The teardown counts from the
        // first failure, RECOVERED brings the workspace back.
        case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
        case 'SUBSCRIPTION_STATE_ON_HOLD':
            return 'past_due'
        // Pause is switched off in the Play Console; one that slips through is read as over.
        case 'SUBSCRIPTION_STATE_PAUSED':
        case 'SUBSCRIPTION_STATE_EXPIRED':
            return 'canceled'
        // A payment still pending (cash, a bank transfer) grants nothing until it is purchased.
        default:
            return null
    }
}

// The state of a Google Play subscription from purchases.subscriptionsv2.get, the full state Google
// recommends reading on every notification. Null while there is nothing to grant (a pending purchase).
//
// The free week is the line item's `offerPhase.freeTrial`; the first paid period is the one after it,
// with an order behind it. `linkedPurchaseToken` is the token this one replaces (a re-signup before
// the old one lapsed, a plan change): the workspace holding the old token moves to the new one.
export function googleSubscriptionState(purchaseToken: string, purchase: GoogleSubscriptionPurchase, productId: string, now: Date, { revoked = false }: { revoked?: boolean } = {}): StoreSubscriptionState | null {
    const item = purchase.lineItems?.find(line => line.productId === productId) ?? purchase.lineItems?.[0]
    const expiry = item?.expiryTime ? Date.parse(item.expiryTime) : NaN
    const running = Number.isFinite(expiry) && expiry > now.getTime()
    const inTrial = !!item?.offerPhase?.freeTrial
    const status = revoked ? 'canceled' : laterStatus(purchase.subscriptionState, running, inTrial)
    if (!status) return null

    const periodEnd = Number.isFinite(expiry) ? new Date(expiry).toISOString() : null
    return {
        provider: 'google',
        subscriptionId: purchaseToken,
        replacesSubscriptionId: purchase.linkedPurchaseToken ?? null,
        accountToken: purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
        environment: purchase.testPurchase ? 'test' : 'production',
        productId: item?.productId ?? '',
        status,
        trialStartedAt: inTrial ? (purchase.startTime ?? null) : null,
        trialEndsAt: inTrial ? periodEnd : null,
        periodEnd,
        cancelAt: running && item?.autoRenewingPlan?.autoRenewEnabled === false ? periodEnd : null,
        paid: !inTrial && !revoked && !!item?.latestSuccessfulOrderId,
        revoked,
    }
}

// An unacknowledged purchase is refunded by Google after three days: the hub acknowledges what it
// applied, the app acknowledges too, and the sweep catches whatever both missed.
export function needsAcknowledgement(purchase: GoogleSubscriptionPurchase): boolean {
    return purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING'
}
