import { STORE_TRIAL_DAYS } from '@rerun/contracts'
import { Platform } from 'react-native'

import type { StorefrontEvents, Storefront } from './types'

// A store that sells without a store, for the labs, Maestro and the captures: `EXPO_PUBLIC_STORE=mock`.
// The purchase it reports is what Xcode's local StoreKit testing signs (an `Xcode` transaction), which
// a local hub started with APPLE_IAP_ACCEPT_XCODE=1 takes for real: the whole flow runs on the
// simulator against the local stack. No production hub accepts it.
const PURCHASE_DELAY_MS = 900

function base64Url(value: object): string {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function xcodeTransaction(productId: string, accountToken: string, { bundleId, trialDays, now = Date.now() }: { bundleId: string; trialDays: number | null; now?: number }): string {
    const header = base64Url({ alg: 'ES256', kid: 'Apple_Xcode_Key' })
    const payload = base64Url({
        transactionId: String(now),
        originalTransactionId: `mock-${now}`,
        bundleId,
        productId,
        purchaseDate: now,
        originalPurchaseDate: now,
        expiresDate: now + (trialDays ?? 30) * 86_400_000,
        type: 'Auto-Renewable Subscription',
        appAccountToken: accountToken,
        inAppOwnershipType: 'PURCHASED',
        signedDate: now,
        environment: 'Xcode',
        transactionReason: 'PURCHASE',
        ...(trialDays ? { offerType: 1, offerDiscountType: 'FREE_TRIAL', price: 0 } : { price: 29990 }),
        currency: 'USD',
    })
    return `${header}.${payload}.bW9jaw`
}

export function mockStorefront(bundleId: string): Storefront {
    let events: StorefrontEvents | null = null
    return {
        provider: Platform.OS === 'android' ? 'google' : 'apple',
        async connect(handlers) {
            events = handlers
            return () => {
                events = null
            }
        },
        async product(productId, { trialEligible }) {
            return { productId, displayPrice: '$29.99', trialDays: trialEligible ? STORE_TRIAL_DAYS : null, offerToken: null }
        },
        async buy(product, accountToken) {
            setTimeout(() => {
                const request = Platform.OS === 'android' ? { store: 'google' as const, purchaseToken: `mock-${Date.now()}`, productId: product.productId } : { store: 'apple' as const, jws: xcodeTransaction(product.productId, accountToken, { bundleId, trialDays: product.trialDays }) }
                events?.onTransaction({ productId: product.productId, request, finish: async () => {} })
            }, PURCHASE_DELAY_MS)
        },
        async restore() {
            return []
        },
        async manage() {},
    }
}
