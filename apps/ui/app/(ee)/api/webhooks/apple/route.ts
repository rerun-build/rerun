import { appleIapConfig } from '@/ee/lib/billing/apple/config'
import { isAppleVerificationFailure, verifyAppleNotification } from '@/ee/lib/billing/apple/verify'
import { claimStoreNotification, markStoreNotificationProcessed, releaseStoreNotification, unclaimedStoreResponse } from '@/ee/lib/billing/store/notification-claim'
import { handleAppleNotification, InvalidStorePurchaseError } from '@/ee/services/store-billing.service'

export const dynamic = 'force-dynamic'

// App Store Server Notifications V2: the production URL of App Store Connect points at the
// production hub, the sandbox URL at staging. The body is one signed payload, verified against Apple's
// root before anything is read from it. Apple retries anything but a 200, for days, so a failure of
// ours answers 500 and a payload that will never verify answers 400.
export async function POST(req: Request) {
    const config = appleIapConfig()
    if (!config) return Response.json({ error: 'The App Store is not configured' }, { status: 500 })

    let signedPayload: unknown
    try {
        signedPayload = ((await req.json()) as { signedPayload?: unknown }).signedPayload
    } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (typeof signedPayload !== 'string' || !signedPayload) return Response.json({ error: 'Missing signedPayload' }, { status: 400 })

    let notification: Awaited<ReturnType<typeof verifyAppleNotification>>['payload']
    try {
        notification = (await verifyAppleNotification(config, signedPayload)).payload
    } catch (err) {
        if (isAppleVerificationFailure(err)) return Response.json({ error: 'Invalid signature' }, { status: 400 })
        console.error('[apple webhook] verification failed', err)
        return Response.json({ error: 'Verification failed' }, { status: 500 })
    }

    const notificationId = notification.notificationUUID
    if (!notificationId) return Response.json({ error: 'Missing notificationUUID' }, { status: 400 })
    const key = { provider: 'apple' as const, notificationId }
    const type = [notification.notificationType, notification.subtype].filter(Boolean).join('/')

    const claim = await claimStoreNotification(key, type, { notificationType: notification.notificationType ?? null, subtype: notification.subtype ?? null, environment: notification.data?.environment ?? null })
    if (claim !== 'claimed') return unclaimedStoreResponse(claim)

    try {
        const outcome = await handleAppleNotification(config, notification)
        if (outcome === 'unknown') console.info(`[apple webhook] ${type} for a subscription no workspace of this hub holds`)
        await markStoreNotificationProcessed(key)
        return Response.json({ received: true, outcome }, { status: 200 })
    } catch (err) {
        // Another app's product or a transaction that does not verify: retrying will not change it.
        if (err instanceof InvalidStorePurchaseError) {
            console.warn('[apple webhook] notification ignored', type, err.message)
            await markStoreNotificationProcessed(key)
            return Response.json({ received: true, outcome: 'ignored' }, { status: 200 })
        }
        await releaseStoreNotification(key)
        console.error('[apple webhook] handler failed', type, err)
        return Response.json({ error: 'Handler failed' }, { status: 500 })
    }
}
