import { claimDelivery, connectionForAccount, handleLinkupEnvelope, markDeliveryProcessed, releaseDelivery } from '@/lib/apps/inbound'
import { eventIdOf, parseEnvelope, verifyLinkupSignature } from '@/lib/apps/linkup/envelope'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
    const rawBody = await req.text()
    const envelope = parseEnvelope(rawBody)
    if (!envelope) return Response.json({ error: 'Not a Linkup event' }, { status: 400 })

    const supabase = createServiceRoleClient()
    const connection = await connectionForAccount(supabase, envelope.account_id)
    if (!connection?.provider_webhook_secret) return Response.json({ ignored: true })

    const signed = verifyLinkupSignature(connection.provider_webhook_secret, req.headers.get('x-linkup-timestamp') ?? '', req.headers.get('x-linkup-signature') ?? '', rawBody, Math.floor(Date.now() / 1000))
    if (!signed) return Response.json({ error: 'Invalid signature' }, { status: 401 })

    const eventId = eventIdOf(envelope, rawBody, req.headers.get('x-linkup-event-id'))
    if (!(await claimDelivery(supabase, eventId, connection.app_slug))) return Response.json({ duplicate: true })

    try {
        await handleLinkupEnvelope(supabase, connection, envelope)
        await markDeliveryProcessed(supabase, eventId)
        return Response.json({ ok: true })
    } catch (err) {
        console.error(`[webhooks:linkup] ${eventId} failed`, err)
        await releaseDelivery(supabase, eventId)
        return Response.json({ error: 'Retry later' }, { status: 500 })
    }
}
