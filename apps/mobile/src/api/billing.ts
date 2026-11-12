import { storeOfferSchema, storePurchaseResultSchema, type StoreOffer, type StorePurchaseRequest, type StorePurchaseResult } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

// What the app may sell this workspace through its store. The hub answers for the store of the
// platform the request comes from (the client header).
export async function fetchStoreOffer(caller: Caller): Promise<StoreOffer> {
    return storeOfferSchema.parse(await api('/api/v1/billing/store', caller))
}

// A transaction the store handed the app, for the hub to verify and apply.
export async function postStorePurchase(caller: Caller, request: StorePurchaseRequest): Promise<StorePurchaseResult> {
    return storePurchaseResultSchema.parse(await api('/api/v1/billing/store/purchases', { ...caller, method: 'POST', body: request }))
}
