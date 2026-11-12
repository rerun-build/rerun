import { z } from 'zod'

import type { ClientPlatform } from './client.js'

// Who bills a workspace: Stripe on the web, the store the mobile app was installed from otherwise.
// Every one of them fills the same subscription columns, so the entitlement reads one shape.
export const BILLING_PROVIDERS = ['stripe', 'apple', 'google'] as const
export const billingProviderSchema = z.enum(BILLING_PROVIDERS)
export type BillingProvider = z.infer<typeof billingProviderSchema>

export const STORE_PROVIDERS = ['apple', 'google'] as const
export const storeProviderSchema = z.enum(STORE_PROVIDERS)
export type StoreProvider = z.infer<typeof storeProviderSchema>

export function isStoreProvider(provider: string | null | undefined): provider is StoreProvider {
    return (STORE_PROVIDERS as readonly string[]).includes(provider ?? '')
}

export function storeProviderOf(platform: ClientPlatform): StoreProvider {
    return platform === 'android' ? 'google' : 'apple'
}

// The stores only sell trials in whole periods: a week is the one closest to the web's five days.
export const STORE_TRIAL_DAYS = 7

// Why the app offers no purchase. `not_sold`: this server sells nothing, or not through this store.
// `member`: only an admin runs the workspace's billing. `subscribed`: the workspace already runs on
// this store, its subscription is managed there. `billed_on_web`: a Stripe plan in force.
// `other_store`: a subscription in force on the other store. `sandbox`, `lifetime_plan`: a workspace
// that has nothing to buy.
export const STORE_OFFER_UNAVAILABLE_REASONS = ['not_sold', 'member', 'subscribed', 'billed_on_web', 'other_store', 'sandbox', 'lifetime_plan'] as const
export const storeOfferUnavailableReasonSchema = z.enum(STORE_OFFER_UNAVAILABLE_REASONS)
export type StoreOfferUnavailableReason = z.infer<typeof storeOfferUnavailableReasonSchema>

// GET /api/v1/billing/store: what the app may sell this workspace. The price, the currency and the
// length of the trial are the store's own, read on the phone. `accountToken` goes with the purchase
// (Apple's appAccountToken, Google's obfuscatedAccountId) and comes back on every transaction, which
// is how the hub ties a subscription to its workspace. `trialEligible` is Rerun's rule, one trial per
// workspace; each store adds its own, one per Apple ID or Google account.
export const storeOfferSchema = z.discriminatedUnion('available', [
    z.object({
        available: z.literal(true),
        provider: storeProviderSchema,
        productId: z.string().min(1),
        accountToken: z.uuid(),
        trialEligible: z.boolean(),
    }),
    z.object({
        available: z.literal(false),
        reason: storeOfferUnavailableReasonSchema,
    }),
])
export type StoreOffer = z.infer<typeof storeOfferSchema>

// POST /api/v1/billing/store/purchases: a transaction the store handed the app, for the hub to verify
// with the store and apply. Apple's is the signed transaction (a JWS), Google's the purchase token.
// `restore` marks the ones sent again by Restore purchases.
export const storePurchaseRequestSchema = z.discriminatedUnion('store', [
    z.object({ store: z.literal('apple'), jws: z.string().min(1).max(20_000), restore: z.boolean().optional() }),
    z.object({ store: z.literal('google'), purchaseToken: z.string().min(1).max(2_000), productId: z.string().min(1).max(200), restore: z.boolean().optional() }),
])
export type StorePurchaseRequest = z.infer<typeof storePurchaseRequestSchema>

// `linked_elsewhere`: the subscription already runs another workspace. `expired`: the store says it is
// over (a restore of a lapsed subscription). `billed_on_web`, `other_store`, `not_sold`: the same
// refusals as the offer, met at purchase time.
export const STORE_PURCHASE_REFUSALS = ['linked_elsewhere', 'expired', 'billed_on_web', 'other_store', 'not_sold'] as const
export const storePurchaseRefusalSchema = z.enum(STORE_PURCHASE_REFUSALS)
export type StorePurchaseRefusal = z.infer<typeof storePurchaseRefusalSchema>

export const storePurchaseResultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), entitled: z.boolean(), status: z.string() }),
    z.object({ ok: z.literal(false), reason: storePurchaseRefusalSchema }),
])
export type StorePurchaseResult = z.infer<typeof storePurchaseResultSchema>
