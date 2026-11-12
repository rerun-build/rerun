import 'server-only'

import { AppStoreServerAPIClient, Environment } from '@apple/app-store-server-library'
import type { AppleIapConfig, AppleServerApiKey } from './config'

export type SignedAppleSubscription = { signedTransactionInfo: string; signedRenewalInfo: string | null }

const API_ENVIRONMENTS: Record<string, Environment> = { Production: Environment.PRODUCTION, Sandbox: Environment.SANDBOX }

// The latest transaction and renewal info Apple holds for a subscription, from the App Store Server
// API, in the environment the purchase came from. Null when Apple knows nothing of it there, and for
// Xcode's local transactions, which no server holds.
export async function fetchAppleSubscription(config: AppleIapConfig, key: AppleServerApiKey, originalTransactionId: string, environment: string): Promise<SignedAppleSubscription | null> {
    const apiEnvironment = API_ENVIRONMENTS[environment]
    if (!apiEnvironment) return null
    const client = new AppStoreServerAPIClient(key.privateKey, key.keyId, key.issuerId, config.bundleId, apiEnvironment)
    const response = await client.getAllSubscriptionStatuses(originalTransactionId)
    for (const group of response.data ?? []) {
        const last = group.lastTransactions?.find(transaction => transaction.originalTransactionId === originalTransactionId)
        if (last?.signedTransactionInfo) return { signedTransactionInfo: last.signedTransactionInfo, signedRenewalInfo: last.signedRenewalInfo ?? null }
    }
    return null
}
