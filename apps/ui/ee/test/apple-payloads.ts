// Apple's payloads as the App Store fills them for the plan, with the values a test changes in front.

export const TEST_BUNDLE_ID = 'build.rerun.app'
export const TEST_PRODUCT_ID = 'rerun.base.monthly'
export const TEST_APP_APPLE_ID = 6825274993
export const TEST_ACCOUNT_TOKEN = '7d7c1c5e-8b8b-4b5e-9d47-0f9a4b0c2a11'

export const TEST_APPLE_CONFIG = { bundleId: TEST_BUNDLE_ID, productId: TEST_PRODUCT_ID, appAppleId: TEST_APP_APPLE_ID, acceptXcode: false }

const DAY_MS = 86_400_000

export function appleTransaction(overrides: Record<string, unknown> = {}, now = Date.now()) {
    return {
        transactionId: '2000000001',
        originalTransactionId: '2000000001',
        webOrderLineItemId: '2000000000000001',
        bundleId: TEST_BUNDLE_ID,
        productId: TEST_PRODUCT_ID,
        subscriptionGroupIdentifier: '21000001',
        purchaseDate: now,
        originalPurchaseDate: now,
        expiresDate: now + 7 * DAY_MS,
        quantity: 1,
        type: 'Auto-Renewable Subscription',
        appAccountToken: TEST_ACCOUNT_TOKEN,
        inAppOwnershipType: 'PURCHASED',
        // When Apple signed it, which is always the real present: the test chain's certificates
        // are checked against this date and only begin on the day they were minted.
        signedDate: Date.now(),
        offerType: 1,
        offerDiscountType: 'FREE_TRIAL',
        environment: 'Sandbox',
        transactionReason: 'PURCHASE',
        storefront: 'USA',
        storefrontId: '143441',
        price: 0,
        currency: 'USD',
        ...overrides,
    }
}

// The first paid month after the free week, `days` after it started.
export function appleRenewal(overrides: Record<string, unknown> = {}, now = Date.now()) {
    return appleTransaction(
        {
            transactionId: '2000000002',
            purchaseDate: now,
            expiresDate: now + 30 * DAY_MS,
            offerType: undefined,
            offerDiscountType: undefined,
            transactionReason: 'RENEWAL',
            price: 29990,
            ...overrides,
        },
        now,
    )
}

export function appleRenewalInfo(overrides: Record<string, unknown> = {}, now = Date.now()) {
    return {
        originalTransactionId: '2000000001',
        autoRenewProductId: TEST_PRODUCT_ID,
        productId: TEST_PRODUCT_ID,
        autoRenewStatus: 1,
        isInBillingRetryPeriod: false,
        signedDate: Date.now(),
        environment: 'Sandbox',
        recentSubscriptionStartDate: now,
        renewalDate: now + 7 * DAY_MS,
        appAccountToken: TEST_ACCOUNT_TOKEN,
        ...overrides,
    }
}

export function appleNotification(type: string, subtype: string | undefined, data: { signedTransactionInfo?: string; signedRenewalInfo?: string }, overrides: Record<string, unknown> = {}, now = Date.now()) {
    return {
        notificationType: type,
        ...(subtype ? { subtype } : {}),
        notificationUUID: `uuid-${type}-${subtype ?? 'none'}-${now}`,
        version: '2.0',
        signedDate: Date.now(),
        data: { appAppleId: TEST_APP_APPLE_ID, bundleId: TEST_BUNDLE_ID, environment: 'Sandbox', status: 1, ...data },
        ...overrides,
    }
}
