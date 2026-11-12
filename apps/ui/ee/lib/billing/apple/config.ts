import 'server-only'

// What the hub needs to sell the plan through Apple In-App Purchase. Without the product, the bundle
// and the app's Apple id, the App Store is not offered: the app hears `not_sold` and shows nothing to
// buy. The In-App Purchase key (issuer, key id, private key) is only needed by the App Store Server
// API, which the hourly sweep reads; purchases and notifications are verified without it.
export type AppleIapConfig = {
    bundleId: string
    productId: string
    appAppleId: number
    // Transactions signed by Xcode's local StoreKit testing, which no Apple certificate signs. Only
    // ever honoured outside production, for a simulator run against a local hub.
    acceptXcode: boolean
}

export type AppleServerApiKey = { issuerId: string; keyId: string; privateKey: string }

export function appleIapConfig(env: NodeJS.ProcessEnv = process.env): AppleIapConfig | null {
    const bundleId = env.APPLE_IAP_BUNDLE_ID?.trim() || 'build.rerun.app'
    const productId = env.APPLE_IAP_PRODUCT_ID?.trim()
    const appAppleId = Number(env.APPLE_APP_APPLE_ID)
    if (!productId || !Number.isInteger(appAppleId) || appAppleId <= 0) return null
    return { bundleId, productId, appAppleId, acceptXcode: env.APPLE_IAP_ACCEPT_XCODE === '1' && env.NODE_ENV !== 'production' }
}

// The key arrives from the panel with its line breaks escaped, the way every PEM in the env does.
export function appleServerApiKey(env: NodeJS.ProcessEnv = process.env): AppleServerApiKey | null {
    const issuerId = env.APPLE_IAP_ISSUER_ID?.trim()
    const keyId = env.APPLE_IAP_KEY_ID?.trim()
    const privateKey = env.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
    if (!issuerId || !keyId || !privateKey) return null
    return { issuerId, keyId, privateKey }
}
