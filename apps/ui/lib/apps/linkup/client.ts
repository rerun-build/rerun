// Linkup, the gateway every paid app call goes through. One API key for Rerun, one account per
// connected LinkedIn profile or WhatsApp number, selected by `account_id` in the body. No
// 'server-only': the archive, expiry and reconciliation tasks delete accounts from Trigger.dev.
//
// Reference: https://docs.linkupapi.com (V2). Every answer is `{ success, data | error, metadata }`.

const BASE_URL = 'https://api.linkupapi.com'
const TIMEOUT_MS = 60_000

export type LinkupErrorCode =
    | 'INVALID_API_KEY'
    | 'INVALID_ACCOUNT'
    | 'ACCOUNT_INACTIVE'
    | 'INVALID_ACTION'
    | 'INVALID_PARAMS'
    | 'RATE_LIMITED'
    | 'INSUFFICIENT_CREDITS'
    | 'SEAT_LIMIT_REACHED'
    | 'CHANNEL_ERROR'
    | 'INTERNAL_ERROR'
    | 'NETWORK_ERROR'

export class LinkupError extends Error {
    constructor(
        readonly code: LinkupErrorCode,
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'LinkupError'
    }
}

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: LinkupErrorCode; message: string } }

function apiKey(): string {
    const key = process.env.LINKUP_API_KEY
    if (!key) throw new LinkupError('INVALID_API_KEY', 'LINKUP_API_KEY is not set', 0)
    return key
}

// LinkedIn ids such as an invitation_id are 19-digit integers, past what a JS number holds: they are
// turned into strings before parsing, or a withdrawal would aim at a rounded, wrong invitation.
const LONG_INTEGER = /([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g

export function parseEnvelope<T>(text: string): Envelope<T> | null {
    try {
        return JSON.parse(text.replace(LONG_INTEGER, '$1"$2"')) as Envelope<T>
    } catch {
        return null
    }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: { 'x-api-key': apiKey(), ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
    } catch (err) {
        if (err instanceof LinkupError) throw err
        throw new LinkupError('NETWORK_ERROR', err instanceof Error ? err.message : 'Linkup is unreachable', 0)
    }
    const envelope = parseEnvelope<T>(await res.text().catch(() => ''))
    if (!envelope) throw new LinkupError('INTERNAL_ERROR', `Linkup answered ${res.status} without a body`, res.status)
    if (!envelope.success) throw new LinkupError(envelope.error?.code ?? 'INTERNAL_ERROR', envelope.error?.message ?? 'Linkup refused the request', res.status)
    return envelope.data
}

// --- Accounts ---

export type LinkupPlatform = 'linkedin' | 'whatsapp'

export type LinkupCheckpointType = 'email' | 'sms' | 'authenticator_app' | 'app_approval' | 'code' | 'whatsapp_qr'

// What WhatsApp hands back while its number is not linked yet: a QR code that renews every ~20 s,
// or the code to type on the phone when the QR would be on the phone itself.
export type LinkupLinkCode = { qrCodeImage: string | null; pairingCode: string | null; expiresInSeconds: number | null }

export type LinkupLoginResult =
    | { status: 'connected'; accountId: string }
    | { status: 'checkpoint_required'; accountId: string; checkpointType: LinkupCheckpointType; sentTo: string | null; message: string | null; link: LinkupLinkCode | null }

type LoginData = {
    account_id: string
    status: 'connected' | 'checkpoint_required' | 'code_sent'
    checkpoint_type?: LinkupCheckpointType
    sent_to?: string
    message?: string
    qr_code_image?: string
    pairing_code?: string
    expires_in_seconds?: number
}

function loginResult(data: LoginData): LinkupLoginResult {
    if (data.status === 'connected') return { status: 'connected', accountId: data.account_id }
    const link = data.qr_code_image || data.pairing_code ? { qrCodeImage: data.qr_code_image ?? null, pairingCode: data.pairing_code ?? null, expiresInSeconds: data.expires_in_seconds ?? null } : null
    return { status: 'checkpoint_required', accountId: data.account_id, checkpointType: data.checkpoint_type ?? 'code', sentTo: data.sent_to ?? null, message: data.message ?? null, link }
}

export async function login(platform: LinkupPlatform, body: Record<string, unknown>): Promise<LinkupLoginResult> {
    return loginResult(await call<LoginData>('POST', '/v2/login', { platform, ...body }))
}

// Without a code, it asks whether an approval in the LinkedIn app went through, or hands the
// current QR code of a WhatsApp number still waiting to be linked.
export async function submitCheckpoint(accountId: string, code?: string): Promise<LinkupLoginResult> {
    return loginResult(await call<LoginData>('POST', '/v2/checkpoint', { account_id: accountId, ...(code ? { code } : {}) }))
}

export async function resendCheckpointCode(accountId: string): Promise<LinkupLoginResult> {
    return loginResult(await call<LoginData>('POST', '/v2/checkpoint', { account_id: accountId, resend: true }))
}

export type LinkupAccount = { account_id: string; platform: string; account_name: string | null; status: 'connected' | 'checkpoint_required' | 'disconnected'; created_at: string }

const LIST_PAGE_SIZE = 500

export async function listAccounts(): Promise<LinkupAccount[]> {
    const accounts: LinkupAccount[] = []
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const page = await call<{ items: LinkupAccount[]; total: number }>('GET', `/v2/accounts?count=${LIST_PAGE_SIZE}&limit=${LIST_PAGE_SIZE}&offset=${offset}`)
        accounts.push(...page.items)
        if (page.items.length < LIST_PAGE_SIZE || accounts.length >= page.total) return accounts
    }
}

// Deleting stops Linkup's billing for the account and drops its webhooks. An account already gone
// is the outcome asked for, not a failure.
export async function deleteAccount(accountId: string): Promise<void> {
    try {
        await call('DELETE', `/v2/accounts/${encodeURIComponent(accountId)}`)
    } catch (err) {
        if (err instanceof LinkupError && err.code === 'INVALID_ACCOUNT') return
        throw err
    }
}

export async function getMe<T>(accountId: string): Promise<T> {
    return call<T>('POST', '/v2/profiles', { account_id: accountId, action: 'get_me' })
}

// --- Webhooks ---

export async function createWebhook(accountId: string, url: string, events: readonly string[]): Promise<{ webhookId: string; secret: string }> {
    const data = await call<{ webhook_id: string; secret?: string }>('POST', '/v2/webhooks', { account_id: accountId, url, events: [...events], retry: true, enable_signature: true })
    if (!data.secret) throw new LinkupError('INTERNAL_ERROR', 'Linkup created the webhook without a signing secret', 200)
    return { webhookId: data.webhook_id, secret: data.secret }
}

// --- Actions ---

export type LinkupCategory = 'profiles' | 'network' | 'messages' | 'content'

export async function runAction<T = unknown>(accountId: string, category: LinkupCategory, action: string, params: Record<string, unknown>): Promise<T> {
    return call<T>('POST', `/v2/${category}`, { account_id: accountId, action, params })
}

// Endpoints that take their parameters flat in the body, without an `action` + `params` pair.
export type LinkupFlatEndpoint = 'typeahead'

export async function runFlatEndpoint<T = unknown>(accountId: string, endpoint: LinkupFlatEndpoint, body: Record<string, unknown>): Promise<T> {
    return call<T>('POST', `/v2/${endpoint}`, { ...body, account_id: accountId })
}

// --- Attachments ---

// Which ids name an attachment depends on the channel: `message_id` on WhatsApp, `conversation_id`
// with `asset_urn` on LinkedIn, `message_id` with `asset_urn` on a Recruiter seat.
export const ATTACHMENT_REF_KEYS = ['message_id', 'conversation_id', 'asset_urn', 'attachment_id', 'filename'] as const

export type AttachmentRef = Partial<Record<(typeof ATTACHMENT_REF_KEYS)[number], string>>

export const ATTACHMENT_PATH = '/v2/messages/attachment'

export type LinkupAttachmentFile = { body: ReadableStream<Uint8Array>; contentType: string; filename: string | null; size: number | null }

function filenameOf(disposition: string | null): string | null {
    if (!disposition) return null
    const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1]
    if (encoded) {
        try {
            return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''))
        } catch {}
    }
    return /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.trim() ?? null
}

// The raw bytes, not the JSON envelope: only a failure answers with one. Each download costs a
// Linkup credit, nothing is kept on their side.
export async function downloadAttachment(accountId: string, ref: AttachmentRef, signal?: AbortSignal): Promise<LinkupAttachmentFile> {
    const query = new URLSearchParams({ account_id: accountId })
    for (const key of ATTACHMENT_REF_KEYS) if (ref[key]) query.set(key, ref[key])
    let res: Response
    try {
        res = await fetch(`${BASE_URL}${ATTACHMENT_PATH}?${query}`, { headers: { 'x-api-key': apiKey() }, signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
        if (err instanceof LinkupError) throw err
        throw new LinkupError('NETWORK_ERROR', err instanceof Error ? err.message : 'Linkup is unreachable', 0)
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    if (!res.ok || !res.body) {
        const envelope = parseEnvelope<unknown>(await res.text().catch(() => ''))
        const error = envelope && !envelope.success ? envelope.error : null
        throw new LinkupError(error?.code ?? 'INTERNAL_ERROR', error?.message ?? `Linkup answered ${res.status} without the file`, res.status)
    }
    const length = Number(res.headers.get('content-length'))
    return { body: res.body, contentType, filename: filenameOf(res.headers.get('content-disposition')), size: Number.isFinite(length) && length > 0 ? length : null }
}
