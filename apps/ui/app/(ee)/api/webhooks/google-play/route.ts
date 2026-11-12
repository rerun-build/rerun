import { googlePlayConfig } from '@/ee/lib/billing/google/config'
import { isAuthenticPush, readPushMessage } from '@/ee/lib/billing/google/push'
import { claimStoreNotification, markStoreNotificationProcessed, releaseStoreNotification, unclaimedStoreResponse } from '@/ee/lib/billing/store/notification-claim'
import { handleGooglePlayNotification } from '@/ee/services/store-billing.service'

export const dynamic = 'force-dynamic'

// Google Play real-time developer notifications, pushed by Pub/Sub. Google Play publishes to one
// topic per app, which two push subscriptions deliver to production and to staging: each hub
// authenticates the push by its OIDC token, reads the purchase again from the Play Developer API and
// answers 200 for a token none of its workspaces holds. Pub/Sub redelivers anything but a 2xx for
// up to seven days, so a failure of ours answers 500 and a push that is not Google's answers 401.
export async function POST(req: Request) {
    const config = googlePlayConfig()
    if (!config) return Response.json({ error: 'Google Play is not configured' }, { status: 500 })
    if (!(await isAuthenticPush(config, req.headers.get('authorization')))) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const message = readPushMessage(body)
    // A malformed message will never parse: acknowledged so Pub/Sub stops redelivering it.
    if (!message) return Response.json({ received: true, outcome: 'ignored' }, { status: 200 })

    const key = { provider: 'google' as const, notificationId: message.messageId }
    const { subscriptionNotification, voidedPurchaseNotification, testNotification } = message.notification
    const type = subscriptionNotification ? `subscription/${subscriptionNotification.notificationType ?? '?'}` : voidedPurchaseNotification ? 'voided' : testNotification ? 'test' : 'other'
    const claim = await claimStoreNotification(key, type, { packageName: message.notification.packageName ?? null, type })
    if (claim !== 'claimed') return unclaimedStoreResponse(claim)

    try {
        const outcome = await handleGooglePlayNotification(config, message.notification)
        if (outcome === 'unknown') console.info(`[google play webhook] ${type} for a purchase no workspace of this hub holds`)
        await markStoreNotificationProcessed(key)
        return Response.json({ received: true, outcome }, { status: 200 })
    } catch (err) {
        await releaseStoreNotification(key)
        console.error('[google play webhook] handler failed', type, err)
        return Response.json({ error: 'Handler failed' }, { status: 500 })
    }
}
