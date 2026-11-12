import 'server-only'

import { appleIapConfig } from '@/ee/lib/billing/apple/config'
import { googlePlayConfig } from '@/ee/lib/billing/google/config'
import { BILLING_ENABLED } from '@rerun/cloud/billing'
import type { StoreProvider } from '@rerun/contracts'

// The product a store sells the plan as, null when this deployment does not sell through that store
// (self-hosted, or the store's settings are not set yet). Until they are, the app keeps the trial it
// started before the stores sold anything, so a deploy never strands the builds already out there.
export function storeProductId(provider: StoreProvider): string | null {
    if (!BILLING_ENABLED) return null
    if (provider === 'apple') return appleIapConfig()?.productId ?? null
    return googlePlayConfig()?.productId ?? null
}
