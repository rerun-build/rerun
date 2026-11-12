import { Platform } from 'react-native'

jest.mock('expo-iap', () => ({
    ErrorCode: { UserCancelled: 'user-cancelled', DeferredPayment: 'deferred-payment', Pending: 'pending' },
    fetchProducts: jest.fn(),
    isEligibleForIntroOfferIOS: jest.fn(async () => true),
    requestPurchase: jest.fn(async () => null),
    initConnection: jest.fn(async () => true),
    showManageSubscriptionsIOS: jest.fn(async () => []),
    deepLinkToSubscriptions: jest.fn(async () => {}),
}))
jest.mock('expo-application', () => ({ applicationId: 'build.rerun.app' }))

import { isoPeriodDays, nativeStorefront } from './native-storefront'

const mockIap = jest.requireMock('expo-iap') as Record<string, jest.Mock>

const phase = (price: string, period: string, formatted: string) => ({ billingCycleCount: 1, billingPeriod: period, formattedPrice: formatted, priceAmountMicros: price, priceCurrencyCode: 'EUR', recurrenceMode: price === '0' ? 2 : 1 })

describe('isoPeriodDays', () => {
    it('reads the length of a Google Play phase', () => {
        expect(isoPeriodDays('P7D')).toBe(7)
        expect(isoPeriodDays('P1W')).toBe(7)
        expect(isoPeriodDays('P1M')).toBe(30)
        expect(isoPeriodDays('nope')).toBeNull()
    })
})

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip
const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnIos('nativeStorefront on iOS', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockIap.isEligibleForIntroOfferIOS.mockResolvedValue(true)
    })

    it('reads the introductory week and asks Apple whether this account still has it', async () => {
        mockIap.fetchProducts.mockResolvedValue([{ id: 'rerun.base.monthly', platform: 'ios', displayPrice: '$29.99', subscriptionGroupIdIOS: '21000001', subscriptionOffers: [{ id: 'intro', type: 'introductory', paymentMode: 'free-trial', period: { unit: 'week', value: 1 }, periodCount: 1, displayPrice: '$0.00', price: 0 }] }])
        expect(await nativeStorefront.product('rerun.base.monthly', { trialEligible: true })).toEqual({ productId: 'rerun.base.monthly', displayPrice: '$29.99', trialDays: 7, offerToken: null })
        mockIap.isEligibleForIntroOfferIOS.mockResolvedValueOnce(false)
        expect(await nativeStorefront.product('rerun.base.monthly', { trialEligible: true })).toMatchObject({ trialDays: null })
    })

    it('buys with the account token as appAccountToken', async () => {
        await nativeStorefront.buy({ productId: 'rerun.base.monthly', displayPrice: '$29.99', trialDays: 7, offerToken: null }, 'token')
        expect(mockIap.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({ type: 'subs', request: expect.objectContaining({ apple: { sku: 'rerun.base.monthly', appAccountToken: 'token' } }) }))
    })

    it('opens the App Store subscriptions', async () => {
        await nativeStorefront.manage()
        expect(mockIap.showManageSubscriptionsIOS).toHaveBeenCalled()
    })
})

describeOnAndroid('nativeStorefront on Android', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockIap.isEligibleForIntroOfferIOS.mockResolvedValue(true)
    })

    const product = {
        id: 'rerun.base.monthly',
        platform: 'android',
        displayPrice: '29,99 €',
        subscriptionOffers: [
            { id: 'free-week', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'trial-token', type: 'introductory', displayPrice: '0 €', price: 0, pricingPhasesAndroid: { pricingPhaseList: [phase('0', 'P1W', 'Free'), phase('29990000', 'P1M', '29,99 €')] } },
            { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-token', type: 'promotional', displayPrice: '29,99 €', price: 29.99, pricingPhasesAndroid: { pricingPhaseList: [phase('29990000', 'P1M', '29,99 €')] } },
        ],
    }

    it('buys the free week offer for a workspace that never had a trial', async () => {
        mockIap.fetchProducts.mockResolvedValue([product])
        expect(await nativeStorefront.product('rerun.base.monthly', { trialEligible: true })).toEqual({ productId: 'rerun.base.monthly', displayPrice: '29,99 €', trialDays: 7, offerToken: 'trial-token' })
    })

    it('buys the plan alone once Rerun says the trial is spent', async () => {
        mockIap.fetchProducts.mockResolvedValue([product])
        expect(await nativeStorefront.product('rerun.base.monthly', { trialEligible: false })).toEqual({ productId: 'rerun.base.monthly', displayPrice: '29,99 €', trialDays: null, offerToken: 'base-token' })
    })

    it('buys the plan alone when Google no longer lists the week for this account', async () => {
        mockIap.fetchProducts.mockResolvedValue([{ ...product, subscriptionOffers: [product.subscriptionOffers[1]] }])
        expect(await nativeStorefront.product('rerun.base.monthly', { trialEligible: true })).toMatchObject({ trialDays: null, offerToken: 'base-token' })
    })

    it('passes the account token and the chosen offer to Google Play', async () => {
        await nativeStorefront.buy({ productId: 'rerun.base.monthly', displayPrice: '29,99 €', trialDays: 7, offerToken: 'trial-token' }, 'token')
        expect(mockIap.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ google: { skus: ['rerun.base.monthly'], obfuscatedAccountId: 'token', subscriptionOffers: [{ sku: 'rerun.base.monthly', offerToken: 'trial-token' }] } }) }))
    })

    it('opens the Google Play subscriptions of the app', async () => {
        await nativeStorefront.manage('rerun.base.monthly')
        expect(mockIap.deepLinkToSubscriptions).toHaveBeenCalledWith({ skuAndroid: 'rerun.base.monthly', packageNameAndroid: 'build.rerun.app' })
    })
})
