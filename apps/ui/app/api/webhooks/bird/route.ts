import type { SupabaseClient } from '@supabase/supabase-js'
import { Webhook } from 'standardwebhooks'
import type { Database } from '@/app/api/database.types'
import { isVerifyEvent, recordVerifyEvent, type VerifyEventData } from '@/app/api/_services/phone-delivery.service'
import { markWhatsAppReplied, markWhatsAppUnreachable, setWhatsAppOptOut } from '@/lib/whatsapp/recipient'
import { MESSAGE_ID_METADATA } from '@/lib/whatsapp/send'
import { applyWhatsAppFailure, applyWhatsAppProgress, loadWhatsAppMessageOwner, type WhatsAppFailureStatus, type WhatsAppProgress } from '@/lib/whatsapp/store'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type Address = { phone_number?: string | null }

type MessageData = {
    direction?: string
    whatsapp_id?: string
    from?: Address | null
    to?: Address | null
    metadata?: Record<string, unknown> | null
    error?: { code?: string | null; description?: string | null; meta_error_code?: string | null; occurred_at?: string | null } | null
}

type PreferenceData = { channel?: string; handle?: string }
type SuppressionData = { address?: string }

type BirdEvent = { type: string; timestamp: string; data?: MessageData & PreferenceData & SuppressionData & VerifyEventData }

const PROGRESS_EVENTS: Record<string, WhatsAppProgress> = { 'whatsapp.sent': 'sent', 'whatsapp.delivered': 'delivered', 'whatsapp.read': 'read' }
const FAILURE_EVENTS: Record<string, WhatsAppFailureStatus> = { 'whatsapp.failed': 'failed', 'whatsapp.rejected': 'rejected' }

const META_UNDELIVERABLE = '131026'
const META_MARKETING_STOPPED = '131050'

function trackedMessageId(data: MessageData): string | null {
    const id = data.metadata?.[MESSAGE_ID_METADATA]
    return data.direction === 'outbound' && typeof id === 'string' ? id : null
}

async function flagFailedNumber(supabase: SupabaseClient<Database>, messageId: string, data: MessageData, at: string): Promise<boolean> {
    const metaCode = data.error?.meta_error_code
    if (metaCode !== META_UNDELIVERABLE && metaCode !== META_MARKETING_STOPPED) return true

    const owner = await loadWhatsAppMessageOwner(supabase, messageId)
    if (!owner || owner.phone !== data.to?.phone_number) return true

    return metaCode === META_UNDELIVERABLE ? markWhatsAppUnreachable(supabase, owner.phone, at) : setWhatsAppOptOut(supabase, owner.phone, at)
}

async function handle(supabase: SupabaseClient<Database>, event: BirdEvent, webhookId: string | null): Promise<boolean> {
    const { type, timestamp, data = {} } = event

    if (isVerifyEvent(type)) {
        await recordVerifyEvent(supabase, type, data, webhookId)
        return true
    }

    const progress = PROGRESS_EVENTS[type]
    const failure = FAILURE_EVENTS[type]
    if (progress || failure) {
        const messageId = trackedMessageId(data)
        if (!messageId) return true
        if (progress) return applyWhatsAppProgress(supabase, messageId, { status: progress, at: timestamp, birdMessageId: data.whatsapp_id ?? '' })

        const at = data.error?.occurred_at ?? timestamp
        const recorded = await applyWhatsAppFailure(supabase, messageId, {
            status: failure,
            at,
            code: data.error?.code ?? null,
            metaCode: data.error?.meta_error_code ?? null,
            description: data.error?.description ?? null,
        })
        return recorded && flagFailedNumber(supabase, messageId, data, at)
    }

    if (type === 'whatsapp.received') {
        const phone = data.direction === 'inbound' ? data.from?.phone_number : null
        return phone ? markWhatsAppReplied(supabase, phone, timestamp) : true
    }

    if ((type === 'preference.revoked' || type === 'preference.granted') && data.channel === 'whatsapp' && data.handle) {
        return setWhatsAppOptOut(supabase, data.handle, type === 'preference.revoked' ? timestamp : null)
    }
    if (type === 'whatsapp_suppression.created' && data.address) return setWhatsAppOptOut(supabase, data.address, timestamp)

    return true
}

export async function POST(req: Request) {
    const secret = process.env.BIRD_WEBHOOK_SECRET
    if (!secret) return Response.json({ error: 'BIRD_WEBHOOK_SECRET is not set' }, { status: 500 })

    let event: BirdEvent
    try {
        event = new Webhook(secret).verify(await req.text(), Object.fromEntries(req.headers)) as BirdEvent
    } catch {
        return Response.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const handled = await handle(createServiceRoleClient(), event, req.headers.get('webhook-id'))
    return handled ? Response.json({ received: true }) : Response.json({ error: 'Write failed' }, { status: 500 })
}
