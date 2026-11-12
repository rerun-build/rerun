import type { GoogleSubscriptionPurchase } from '@/ee/lib/billing/google/state'

export const TEST_GOOGLE_PRODUCT_ID = 'rerun.base.monthly'
export const TEST_GOOGLE_ACCOUNT_TOKEN = '0b8f2d2c-1f6e-4a52-9c2e-5f7d3f1c9a10'
export const TEST_PUSH_AUDIENCE = 'https://app.rerun.build/api/webhooks/google-play'
export const TEST_PUSH_SERVICE_ACCOUNT = 'play-rtdn-push@rerun-499110.iam.gserviceaccount.com'

export const TEST_GOOGLE_CONFIG = {
    packageName: 'build.rerun.app',
    productId: TEST_GOOGLE_PRODUCT_ID,
    serviceAccount: { client_email: 'rerun-hub-play@rerun-499110.iam.gserviceaccount.com', private_key: 'test' },
    pushAudience: TEST_PUSH_AUDIENCE,
    pushServiceAccount: TEST_PUSH_SERVICE_ACCOUNT,
}

const DAY_MS = 86_400_000

// purchases.subscriptionsv2.get for the plan, in its free week by default.
export function googlePurchase(overrides: Partial<GoogleSubscriptionPurchase> = {}, line: Record<string, unknown> = {}, now = Date.now()): GoogleSubscriptionPurchase {
    return {
        kind: 'androidpublisher#subscriptionPurchaseV2',
        startTime: new Date(now).toISOString(),
        regionCode: 'US',
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
        externalAccountIdentifiers: { obfuscatedExternalAccountId: TEST_GOOGLE_ACCOUNT_TOKEN },
        lineItems: [
            {
                productId: TEST_GOOGLE_PRODUCT_ID,
                expiryTime: new Date(now + 7 * DAY_MS).toISOString(),
                autoRenewingPlan: { autoRenewEnabled: true },
                offerDetails: { basePlanId: 'monthly', offerId: 'free-week' },
                offerPhase: { freeTrial: {} },
                ...line,
            },
        ],
        ...overrides,
    }
}

// The first paid month after the free week.
export function googlePaidPurchase(overrides: Partial<GoogleSubscriptionPurchase> = {}, now = Date.now()): GoogleSubscriptionPurchase {
    return googlePurchase({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', ...overrides }, { expiryTime: new Date(now + 30 * DAY_MS).toISOString(), offerPhase: { basePrice: {} }, offerDetails: { basePlanId: 'monthly' }, latestSuccessfulOrderId: 'GPA.3333-1111-2222-44444' }, now)
}

export function pushBody(notification: object, messageId = 'msg-1') {
    return { message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName: 'build.rerun.app', eventTimeMillis: String(Date.now()), ...notification })).toString('base64'), messageId, publishTime: new Date().toISOString() }, subscription: 'projects/rerun-499110/subscriptions/play-rtdn-prod' }
}
