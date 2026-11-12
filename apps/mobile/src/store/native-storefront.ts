import * as Application from 'expo-application'
import {
    ErrorCode,
    deepLinkToSubscriptions,
    endConnection,
    fetchProducts,
    finishTransaction,
    getAvailablePurchases,
    initConnection,
    isEligibleForIntroOfferIOS,
    purchaseErrorListener,
    purchaseUpdatedListener,
    requestPurchase,
    restorePurchases,
    showManageSubscriptionsIOS,
    type ProductSubscription,
    type ProductSubscriptionAndroid,
    type ProductSubscriptionIOS,
    type Purchase,
    type SubscriptionOffer,
} from 'expo-iap'
import { Platform } from 'react-native'

import type { StoreProduct, StoreTransaction, Storefront } from './types'

const DAYS_PER_UNIT: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 }

// `P7D`, `P1W`, `P1M`: the length of a Google Play pricing phase.
export function isoPeriodDays(period: string | null | undefined): number | null {
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(period ?? '')
    if (!match) return null
    const [, years, months, weeks, days] = match.map(part => Number(part ?? 0))
    const total = years * 365 + months * 30 + weeks * 7 + days
    return total > 0 ? total : null
}

function offerDays(offer: SubscriptionOffer): number | null {
    if (!offer.period) return null
    const perUnit = DAYS_PER_UNIT[offer.period.unit]
    return perUnit ? perUnit * offer.period.value * (offer.periodCount ?? 1) : null
}

// The free introductory offer, read from the standard offers first and from StoreKit's own fields
// otherwise. Apple decides who gets it, per Apple Account: a spent one is not offered again.
async function appleProduct(product: ProductSubscriptionIOS): Promise<StoreProduct> {
    const intro = product.subscriptionOffers?.find(offer => offer.type === 'introductory' && offer.paymentMode === 'free-trial')
    const legacyDays = product.introductoryPricePaymentModeIOS === 'free-trial' ? (DAYS_PER_UNIT[product.introductoryPriceSubscriptionPeriodIOS ?? ''] ?? 0) * Number(product.introductoryPriceNumberOfPeriodsIOS ?? 1) || null : null
    const days = intro ? offerDays(intro) : legacyDays
    const eligible = days && product.subscriptionGroupIdIOS ? await isEligibleForIntroOfferIOS(product.subscriptionGroupIdIOS).catch(() => true) : Boolean(days)
    return { productId: product.id, displayPrice: product.displayPrice, trialDays: eligible ? days : null, offerToken: null }
}

const phasesOf = (offer: SubscriptionOffer) => offer.pricingPhasesAndroid?.pricingPhaseList ?? []
const isFree = (offer: SubscriptionOffer) => phasesOf(offer).some(phase => phase.priceAmountMicros === '0')

// Google lists only the offers this Google account may take: the free week is there for a new
// subscriber and gone otherwise. Rerun's own rule, one trial per workspace, can drop it too.
function googleProduct(product: ProductSubscriptionAndroid, trialEligible: boolean): StoreProduct | null {
    const offers = product.subscriptionOffers ?? []
    const trial = offers.find(isFree)
    const plain = offers.find(offer => !isFree(offer) && phasesOf(offer).length === 1) ?? offers.find(offer => !isFree(offer))
    const chosen = trialEligible && trial ? trial : plain
    if (!chosen?.offerTokenAndroid) return null
    const recurring = phasesOf(chosen).at(-1)
    const freePhase = phasesOf(chosen).find(phase => phase.priceAmountMicros === '0')
    return {
        productId: product.id,
        displayPrice: recurring?.formattedPrice ?? product.displayPrice,
        trialDays: freePhase ? isoPeriodDays(freePhase.billingPeriod) : null,
        offerToken: chosen.offerTokenAndroid,
    }
}

function transactionOf(purchase: Purchase): StoreTransaction | null {
    if (!purchase.purchaseToken) return null
    const request = Platform.OS === 'ios' ? { store: 'apple' as const, jws: purchase.purchaseToken } : { store: 'google' as const, purchaseToken: purchase.purchaseToken, productId: purchase.productId }
    return { productId: purchase.productId, request, finish: () => finishTransaction({ purchase, isConsumable: false }) }
}

export const nativeStorefront: Storefront = {
    provider: Platform.OS === 'android' ? 'google' : 'apple',

    async connect(events) {
        await initConnection()
        const updates = purchaseUpdatedListener(purchase => {
            if (purchase.purchaseState === 'pending') return events.onPending()
            const transaction = transactionOf(purchase)
            if (transaction) events.onTransaction(transaction)
        })
        const errors = purchaseErrorListener(error => {
            if (error.code === ErrorCode.UserCancelled) events.onCancelled()
            else if (error.code === ErrorCode.DeferredPayment || error.code === ErrorCode.Pending) events.onPending()
            else events.onError(error.message || String(error.code ?? 'unknown'))
        })
        return () => {
            updates.remove()
            errors.remove()
            void endConnection().catch(() => {})
        }
    },

    async product(productId, { trialEligible }) {
        const products = ((await fetchProducts({ skus: [productId], type: 'subs' })) ?? []) as ProductSubscription[]
        const product = products.find(candidate => candidate.id === productId)
        if (!product) return null
        return product.platform === 'ios' ? appleProduct(product) : googleProduct(product, trialEligible)
    },

    async buy(product, accountToken) {
        await requestPurchase({
            type: 'subs',
            request: {
                apple: { sku: product.productId, appAccountToken: accountToken },
                google: { skus: [product.productId], obfuscatedAccountId: accountToken, subscriptionOffers: product.offerToken ? [{ sku: product.productId, offerToken: product.offerToken }] : [] },
            },
        })
    },

    async restore(productId) {
        await restorePurchases()
        const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })
        return purchases.filter(purchase => purchase.productId === productId && purchase.purchaseState !== 'pending').flatMap(purchase => transactionOf(purchase) ?? [])
    },

    async manage(productId) {
        await initConnection().catch(() => false)
        if (Platform.OS === 'ios') await showManageSubscriptionsIOS()
        else await deepLinkToSubscriptions({ skuAndroid: productId, packageNameAndroid: Application.applicationId })
    },
}
