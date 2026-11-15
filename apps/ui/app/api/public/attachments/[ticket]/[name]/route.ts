import { readAttachmentTicketFromEnv } from '@/lib/apps/attachments'
import { fileResponseHeaders } from '@/lib/files/content-type'
import { LinkupError, downloadAttachment } from '@/lib/apps/linkup/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const GONE_STATUSES = ['deleted', 'needs_reconnect']

type Params = { params: Promise<{ ticket: string; name: string }> }

function fileName(segment: string): string {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

type Ticket = NonNullable<ReturnType<typeof readAttachmentTicketFromEnv>>

async function resolve(ticketToken: string): Promise<{ ok: true; ticket: Ticket; accountId: string } | { ok: false; refusal: Response }> {
    const ticket = readAttachmentTicketFromEnv(ticketToken)
    if (!ticket) return { ok: false, refusal: new Response('This link is invalid or has expired.', { status: 410 }) }
    const { data: connection } = await selectMaybeSingle(createServiceRoleClient(), 'app_connections', ['provider_account_id', 'status'] as const, { id: ticket.c })
    if (!connection?.provider_account_id || GONE_STATUSES.includes(connection.status)) return { ok: false, refusal: new Response('This account is no longer connected.', { status: 410 }) }
    return { ok: true, ticket, accountId: connection.provider_account_id }
}

function fileHeaders(contentType: string, name: string, exp: number, size: number | null): Headers {
    const headers = new Headers({
        ...fileResponseHeaders(contentType, name),
        'Cache-Control': `private, max-age=${Math.max(0, Math.floor((exp - Date.now()) / 1000))}`,
        'X-Robots-Tag': 'noindex, nofollow',
    })
    if (size !== null) headers.set('Content-Length', String(size))
    return headers
}

export async function HEAD(_req: Request, { params }: Params): Promise<Response> {
    const { ticket: token, name } = await params
    const resolved = await resolve(token)
    if (!resolved.ok) return new Response(null, { status: resolved.refusal.status })
    return new Response(null, { status: 200, headers: fileHeaders(resolved.ticket.t ?? 'application/octet-stream', fileName(name), resolved.ticket.exp, null) })
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
    const { ticket: token, name } = await params
    const resolved = await resolve(token)
    if (!resolved.ok) return resolved.refusal
    try {
        const file = await downloadAttachment(resolved.accountId, resolved.ticket.r, req.signal)
        return new Response(file.body, { status: 200, headers: fileHeaders(file.contentType, fileName(name), resolved.ticket.exp, file.size) })
    } catch (err) {
        if (err instanceof LinkupError && err.code === 'INVALID_PARAMS') return new Response('This file is no longer available.', { status: 404 })
        if (err instanceof LinkupError && (err.code === 'ACCOUNT_INACTIVE' || err.code === 'INVALID_ACCOUNT')) return new Response('This account is no longer connected.', { status: 410 })
        console.error('[attachments] download failed', err instanceof LinkupError ? `${err.code} ${err.message}` : err)
        return new Response('The file could not be fetched. Try again later.', { status: 502 })
    }
}
