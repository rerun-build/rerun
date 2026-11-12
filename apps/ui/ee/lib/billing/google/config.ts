import 'server-only'

export type GoogleServiceAccount = { client_email: string; private_key: string }

// What the hub needs to sell the plan through Google Play Billing: the app's package, the
// subscription it sells, and the service account that reads purchases from the Play Developer API.
// The push audience and the push service account are the two halves of the OIDC token Pub/Sub puts
// on every real-time notification: without them, the webhook refuses everything.
export type GooglePlayConfig = {
    packageName: string
    productId: string
    serviceAccount: GoogleServiceAccount
    pushAudience: string | null
    pushServiceAccount: string | null
}

function parseServiceAccount(raw: string | undefined): GoogleServiceAccount | null {
    if (!raw?.trim()) return null
    try {
        const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>
        if (!parsed.client_email || !parsed.private_key) return null
        return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') }
    } catch {
        return null
    }
}

export function googlePlayConfig(env: NodeJS.ProcessEnv = process.env): GooglePlayConfig | null {
    const productId = env.GOOGLE_PLAY_PRODUCT_ID?.trim()
    const serviceAccount = parseServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)
    if (!productId || !serviceAccount) return null
    return {
        packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || 'build.rerun.app',
        productId,
        serviceAccount,
        pushAudience: env.GOOGLE_PLAY_PUSH_AUDIENCE?.trim() || null,
        pushServiceAccount: env.GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT?.trim() || null,
    }
}
