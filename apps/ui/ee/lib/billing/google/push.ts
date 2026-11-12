import 'server-only'

import { OAuth2Client } from 'google-auth-library'
import type { GooglePlayConfig } from './config'

// A Pub/Sub push carries an OIDC token signed by Google for the push subscription's service account,
// minted for the audience set on the subscription. The hub trusts a push only if both match what it
// was configured with: anyone can POST to the URL, nobody else can mint that token.
export type PushVerifier = (idToken: string, audience: string) => Promise<{ email?: string; email_verified?: boolean } | undefined>

const googleVerifier: PushVerifier = async (idToken, audience) => (await new OAuth2Client().verifyIdToken({ idToken, audience })).getPayload()

export async function isAuthenticPush(config: GooglePlayConfig, authorization: string | null, verify: PushVerifier = googleVerifier): Promise<boolean> {
    if (!config.pushAudience || !config.pushServiceAccount) return false
    const token = authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) return false
    try {
        const claims = await verify(token, config.pushAudience)
        return !!claims?.email_verified && claims.email === config.pushServiceAccount
    } catch {
        return false
    }
}

// What Google Play publishes on the topic: one developer notification per message, base64 JSON.
export type DeveloperNotification = {
    packageName?: string
    eventTimeMillis?: string
    subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string }
    voidedPurchaseNotification?: { purchaseToken?: string; orderId?: string; productType?: number }
    testNotification?: { version?: string }
}

export type PushMessage = { messageId: string; notification: DeveloperNotification }

export function readPushMessage(body: unknown): PushMessage | null {
    const message = (body as { message?: { data?: unknown; messageId?: unknown; message_id?: unknown } } | null)?.message
    const messageId = typeof message?.messageId === 'string' ? message.messageId : typeof message?.message_id === 'string' ? message.message_id : null
    if (!messageId || typeof message?.data !== 'string') return null
    try {
        return { messageId, notification: JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')) as DeveloperNotification }
    } catch {
        return null
    }
}
