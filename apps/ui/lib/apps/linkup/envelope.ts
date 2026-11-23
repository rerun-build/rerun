import { createHmac, timingSafeEqual } from 'node:crypto'

// What Linkup posts to /api/webhooks/linkup, signed per webhook, for every app alike. Pure, so the
// route stays a thin shell over it and every rule here is tested. What an event means to a coworker
// is each app's own reading, in its events.ts.

// A delivery older than this is refused even with a valid signature: a captured request replayed
// later must not wake a coworker again.
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export function verifyLinkupSignature(secret: string, timestamp: string, signature: string, rawBody: string, nowSeconds: number): boolean {
    if (!signature.startsWith('v1=') || !/^\d+$/.test(timestamp)) return false
    if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')
    const given = signature.slice(3)
    if (given.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given))
}

export type LinkupPerson = { name?: string; profile_url?: string; job_title?: string; subtitle?: string; message?: string; phone_number?: string; jid?: string; is_self_sent?: boolean }

// `url` is LinkedIn's own link, private and short-lived: `download_url` is the one to follow.
export type LinkupAttachment = {
    type?: string
    name?: string
    filename?: string
    mime_type?: string
    byte_size?: number
    size?: number
    duration_ms?: number
    asset_urn?: string
    attachment_id?: string
    message_id?: string
    url?: string | null
    download_url?: string
}

export type LinkupEnvelope = {
    event_id?: string
    account_id: string
    platform?: string
    event: {
        type: string
        timestamp?: string
        reason?: string
        direction?: string
        inbox?: string
        message_text?: string
        message_type?: string
        message_id?: string
        conversation_id?: string
        is_group_chat?: boolean
        has_attachments?: boolean
        attachments?: LinkupAttachment[]
        sender?: LinkupPerson
        conversation?: { participants?: LinkupPerson[]; is_group_chat?: boolean; name?: string }
        metadata?: { conversation_urn?: string; entity_urn?: string; message_id?: string; conversation_id?: string }
        reply_to?: { message_text?: string; sender_name?: string }
        new_connections?: LinkupPerson[]
        new_invitations?: LinkupPerson[]
        count?: number
    }
    timestamp?: string
}

export function parseEnvelope(rawBody: string): LinkupEnvelope | null {
    try {
        const parsed = JSON.parse(rawBody) as LinkupEnvelope
        if (!parsed || typeof parsed.account_id !== 'string' || typeof parsed.event?.type !== 'string') return null
        return parsed
    } catch {
        return null
    }
}

export type EnvelopeKind<E extends string = string> = { kind: 'wake'; event: E } | { kind: 'disconnection'; reason: string } | { kind: 'ignored' }

// Older deliveries in the docs omit `event_id`: a hash of the body stands in, so a retry of the
// same payload still dedupes.
export function eventIdOf(envelope: LinkupEnvelope, rawBody: string, header: string | null): string {
    return envelope.event_id || header || createHmac('sha256', 'linkup-event').update(rawBody).digest('hex')
}

// The account an event happened on, as the coworker can name it in its tools.
export type WakeAccount = { label: string | null; id: string | null }

export const WAKE_ACCOUNT_HINT =
    'The account of the payload is the one it happened on. When your tools take an account, pass that one (or accountId when two of your accounts share a name): what comes in on an account is answered from it.'
