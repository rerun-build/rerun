import type { StoreProvider, StorePurchaseRequest } from '@rerun/contracts'

// The plan as the store sells it on this phone: its price formatted by the store in the account's
// currency, and the free trial this store account still has, if any. Android also needs the offer
// to buy (the free week, or the plan alone once the week is spent).
export type StoreProduct = {
    productId: string
    displayPrice: string
    trialDays: number | null
    offerToken: string | null
}

// A purchase the store reports, ready for the hub: `finish` closes it in the store (StoreKit's
// finishTransaction, Google's acknowledgement) once the hub has it.
export type StoreTransaction = {
    productId: string
    request: StorePurchaseRequest
    finish: () => Promise<void>
}

export type StorefrontEvents = {
    onTransaction: (transaction: StoreTransaction) => void
    // The payment is waiting on the bank or on a parent (Ask to Buy, cash): nothing is granted yet.
    onPending: () => void
    onCancelled: () => void
    onError: (message: string) => void
}

// The store the app was installed from, behind one interface: the screens never know which one.
export interface Storefront {
    provider: StoreProvider
    // Resolves to the function that disconnects.
    connect(events: StorefrontEvents): Promise<() => void>
    product(productId: string, options: { trialEligible: boolean }): Promise<StoreProduct | null>
    // Opens the store's sheet: the outcome arrives through the events.
    buy(product: StoreProduct, accountToken: string): Promise<void>
    restore(productId: string): Promise<StoreTransaction[]>
    // The store's own page of the account's subscriptions, the one place a store subscription is
    // changed or cancelled.
    manage(productId?: string): Promise<void>
}
