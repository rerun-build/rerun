import 'server-only'

import { androidpublisher, type androidpublisher_v3 } from '@googleapis/androidpublisher'
import { JWT } from 'google-auth-library'
import type { GooglePlayConfig } from './config'
import type { GoogleSubscriptionPurchase } from './state'

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

let cached: { config: GooglePlayConfig; client: androidpublisher_v3.Androidpublisher } | null = null

function publisher(config: GooglePlayConfig): androidpublisher_v3.Androidpublisher {
    if (cached?.config === config) return cached.client
    const auth = new JWT({ email: config.serviceAccount.client_email, key: config.serviceAccount.private_key, scopes: [SCOPE] })
    cached = { config, client: androidpublisher({ version: 'v3', auth }) }
    return cached.client
}

// The whole state of a subscription purchase. Null for a token Google does not know (a 404, or a
// 410 for a purchase older than Google keeps): there is nothing to apply.
export async function fetchGoogleSubscription(config: GooglePlayConfig, purchaseToken: string): Promise<GoogleSubscriptionPurchase | null> {
    try {
        const { data } = await publisher(config).purchases.subscriptionsv2.get({ packageName: config.packageName, token: purchaseToken })
        return data
    } catch (err) {
        const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code
        if (status === 404 || status === 410) return null
        throw err
    }
}

// The v2 API has no acknowledge: the v1 endpoint takes the subscription id beside the token.
export async function acknowledgeGoogleSubscription(config: GooglePlayConfig, purchaseToken: string, productId: string): Promise<void> {
    await publisher(config).purchases.subscriptions.acknowledge({ packageName: config.packageName, subscriptionId: productId, token: purchaseToken, requestBody: {} })
}
