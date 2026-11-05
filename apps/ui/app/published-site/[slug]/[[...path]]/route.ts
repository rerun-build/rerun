import { callerIp } from '@/lib/auth/caller-ip'
import { isInlineSafeContentType, siteContentType, withUtf8Charset } from '@/lib/files/content-type'
import { cookieTtlMs, openAccessTicket } from '@/lib/published/access-ticket'
import { injectBadge } from '@/lib/published/badge'
import { claimPasswordTry, normalizedEmail, sendAccessCode, verifyAccessCode } from '@/lib/published/codes'
import {
    accessCookieHeader,
    clearAccessCookieHeader,
    GATE_EMAIL_PARAM,
    GATE_ERROR_PARAM,
    isHtmlContentType,
    isSecureRequest,
    loadPublished,
    loadWorkspaceBrand,
    mayOpen,
    previewImageUrl,
    readAccessCookie,
    safeNextPath,
    type GateError,
    type PublishedEntry,
} from '@/lib/published/gate'
import { extractPublishedSlug, publishedSiteOrigin } from '@/lib/published/host'
import { injectPreviewMeta } from '@/lib/published/meta'
import { publishedOgImage } from '@/lib/published/og-image'
import { verifyPassword } from '@/lib/published/password'
import { resolveSitePath, siteObjectKey } from '@/lib/published/site-path'
import { PUBLISHED_BUCKET } from '@/lib/services/publish'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// What `<slug>.rerun.site` serves, reached only through the host rewrite in proxy.ts: the site's
// files once the visitor may open the link, and the reserved `/__rerun/` paths (the gate's forms,
// the raw file, the preview image). The bytes live in the private `published` bucket and only
// ever leave it through here, after the same access check the proxy made.
export const dynamic = 'force-dynamic'

const BASE_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex',
}

const SIGNED_URL_TTL_SECONDS = 60
const OG_CACHE_CONTROL = 'public, max-age=300'

type Params = { params: Promise<{ slug: string; path?: string[] }> }

function notFound(): Response {
    return new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'Cache-Control': 'no-store' } })
}

function isStreamedMedia(contentType: string): boolean {
    return contentType.startsWith('video/') || contentType.startsWith('audio/')
}

function originOf(slug: string, request: Request): string {
    return publishedSiteOrigin(slug) ?? new URL(request.url).origin
}

function seeOther(location: string, cookie?: string): Response {
    const headers = new Headers({ ...BASE_HEADERS, Location: location, 'Cache-Control': 'no-store' })
    if (cookie) headers.append('Set-Cookie', cookie)
    return new Response(null, { status: 303, headers })
}

function backToGate(slug: string, request: Request, next: string, params: { error?: GateError; email?: string }): Response {
    const url = new URL(next, originOf(slug, request))
    if (params.error) url.searchParams.set(GATE_ERROR_PARAM, params.error)
    if (params.email) url.searchParams.set(GATE_EMAIL_PARAM, params.email)
    return seeOther(url.toString())
}

function intoPage(slug: string, request: Request, next: string, entry: PublishedEntry, grant: 'member' | 'password' | 'invite' | 'shot', sub: string): Response {
    const secure = isSecureRequest(request)
    const cookie = accessCookieHeader(entry, grant, sub, secure, Math.floor(cookieTtlMs(grant) / 1000))
    return seeOther(new URL(next, originOf(slug, request)).toString(), cookie)
}

async function signedUrl(key: string): Promise<string | null> {
    const { data } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS)
    return data?.signedUrl ?? null
}

const RELAYED_MEDIA_HEADERS = ['Content-Length', 'Content-Range', 'Accept-Ranges'] as const

// A player asks for byte ranges as it plays, seeks and resumes, sometimes minutes apart. Each range
// comes through here and passes the access check again, then goes to Storage with a fresh signed
// URL: a redirect would hand the player a URL that dies a minute later and freezes the playback.
async function streamMedia(entry: PublishedEntry, request: Request, key: string, contentType: string): Promise<Response> {
    const url = await signedUrl(key)
    if (!url) return notFound()
    const range = request.headers.get('range')
    const upstream = await fetch(url, { headers: range ? { Range: range } : undefined })
    if (!upstream.ok || !upstream.body) return upstream.status === 416 ? new Response(null, { status: 416, headers: BASE_HEADERS }) : notFound()

    const headers = new Headers({
        ...BASE_HEADERS,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': entry.access === 'public' ? 'public, max-age=300' : 'private, max-age=300',
    })
    for (const name of RELAYED_MEDIA_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
}

async function previewMetaFor(entry: PublishedEntry, request: Request) {
    const [brand, { data: agent }] = await Promise.all([
        loadWorkspaceBrand(entry.workspace_id),
        selectMaybeSingle(createServiceRoleClient(), 'agents', ['name'] as const, { id: entry.agent_id }),
    ])
    return {
        title: entry.title ?? 'Published page',
        description: agent?.name ? `Published by ${agent.name} at ${brand.name}` : `Published at ${brand.name}`,
        image: previewImageUrl(entry, originOf(entry.slug, request)),
        url: `${originOf(entry.slug, request)}/`,
    }
}

async function serveObject(entry: PublishedEntry, request: Request, key: string, contentType: string): Promise<Response> {
    if (isStreamedMedia(contentType)) return streamMedia(entry, request, key, contentType)

    const { data: blob } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).download(key)
    if (!blob) return notFound()

    const html = isHtmlContentType(contentType)
    // A page answers fresh every time: who may open it can change from one request to the next.
    const cacheControl = html ? 'private, no-cache' : entry.access === 'public' ? 'public, max-age=300' : 'private, max-age=300'
    const headers = { ...BASE_HEADERS, 'Content-Type': contentType, 'Cache-Control': cacheControl }
    if (!html) return new Response(blob.stream(), { headers })

    let page = injectBadge(await blob.text(), entry.slug)
    if (entry.access === 'public') page = injectPreviewMeta(page, await previewMetaFor(entry, request))
    return new Response(page, { headers })
}

async function serveContent(entry: PublishedEntry, request: Request, path: string[]): Promise<Response> {
    if (entry.kind === 'site') {
        const files = entry.files ?? []
        const index = resolveSitePath(path, files)
        if (index === null) return notFound()
        return serveObject(entry, request, siteObjectKey(entry.storage_key, index), siteContentType(files[index]))
    }
    if (path.length > 0) return notFound()
    return serveObject(entry, request, entry.storage_key, withUtf8Charset(entry.content_type))
}

function fileNameOf(path: string): string {
    return path.split(/[\\/]/).pop() || 'file'
}

function contentDisposition(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

// The viewer's own fetches (pdf.js above all) stay on this origin: a redirect to Storage would make
// them cross-origin.
async function serveRaw(entry: PublishedEntry, request: Request): Promise<Response> {
    if (entry.kind === 'site') return notFound()
    const name = fileNameOf(entry.source_path)
    const download = new URL(request.url).searchParams.has('download')
    const contentType = withUtf8Charset(entry.content_type)

    if (!download && isStreamedMedia(contentType)) return streamMedia(entry, request, entry.storage_key, contentType)

    const { data: blob } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).download(entry.storage_key)
    if (!blob) return notFound()
    // Served from the page's own origin, so a file a browser would run scripts in (HTML, SVG) only
    // ever comes down as an attachment, never as a document of this host.
    const attachment = download || !isInlineSafeContentType(contentType)
    const headers: Record<string, string> = {
        ...BASE_HEADERS,
        'Content-Type': attachment ? 'application/octet-stream' : contentType,
        'Content-Length': String(blob.size),
        'Cache-Control': entry.access === 'public' ? 'public, max-age=300' : 'private, max-age=300',
    }
    if (attachment) headers['Content-Disposition'] = contentDisposition(name)
    return new Response(blob.stream(), { headers })
}

async function thumbnailDataUrl(key: string | null): Promise<string | null> {
    if (!key) return null
    const { data } = await createServiceRoleClient().storage.from(PUBLISHED_BUCKET).download(key)
    if (!data) return null
    return `data:${data.type || 'image/png'};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`
}

// Satori only draws raster images it can fetch: a workspace logo is re-encoded to PNG, and left out
// when that fails.
async function logoDataUrl(url: string | null): Promise<string | null> {
    if (!url) return null
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        const { default: sharp } = await import('sharp')
        const png = await sharp(Buffer.from(await res.arrayBuffer())).resize(80, 80, { fit: 'cover' }).png().toBuffer()
        return `data:image/png;base64,${png.toString('base64')}`
    } catch {
        return null
    }
}

async function serveOgImage(entry: PublishedEntry): Promise<Response> {
    const locked = entry.access !== 'public'
    const [brand, { data: agent }, thumbnail] = await Promise.all([
        loadWorkspaceBrand(entry.workspace_id),
        selectMaybeSingle(createServiceRoleClient(), 'agents', ['name'] as const, { id: entry.agent_id }),
        locked ? null : thumbnailDataUrl(entry.thumbnail_key),
    ])
    const image = await publishedOgImage({
        locked,
        title: entry.title ?? 'Published page',
        workspaceName: brand.name,
        workspaceIconUrl: await logoDataUrl(brand.iconUrl),
        coworkerName: agent?.name ?? null,
        thumbnailDataUrl: thumbnail,
    })
    const headers = new Headers(image.headers)
    headers.set('Cache-Control', OG_CACHE_CONTROL)
    return new Response(image.body, { status: 200, headers })
}

// A member's round trip through the app, or the capture service, lands here with a ticket minted a
// minute ago for this link and this access version, and leaves with the cookie.
function redeemTicket(entry: PublishedEntry, request: Request): Response {
    const url = new URL(request.url)
    const next = safeNextPath(url.searchParams.get('next'))
    const ticket = openAccessTicket(url.searchParams.get('ticket'), entry.slug)
    if (!ticket || ticket.v !== entry.access_version) return seeOther(new URL(next, originOf(entry.slug, request)).toString())
    return intoPage(entry.slug, request, next, entry, ticket.grant, ticket.sub)
}

async function formOf(request: Request): Promise<FormData | null> {
    try {
        return await request.formData()
    } catch {
        return null
    }
}

async function checkPassword(entry: PublishedEntry, request: Request): Promise<Response> {
    const form = await formOf(request)
    const next = safeNextPath(form?.get('next')?.toString())
    if (entry.access !== 'password') return seeOther(new URL(next, originOf(entry.slug, request)).toString())
    if (!(await claimPasswordTry(entry.slug, callerIp(request.headers)))) return backToGate(entry.slug, request, next, { error: 'limited' })
    const password = form?.get('password')?.toString() ?? ''
    if (!(await verifyPassword(password, entry.password_hash))) return backToGate(entry.slug, request, next, { error: 'password' })
    return intoPage(entry.slug, request, next, entry, 'password', 'password')
}

async function sendCode(entry: PublishedEntry, request: Request): Promise<Response> {
    const form = await formOf(request)
    const next = safeNextPath(form?.get('next')?.toString())
    const email = normalizedEmail(form?.get('email')?.toString())
    if (!email) return backToGate(entry.slug, request, next, { error: 'email' })
    const outcome = await sendAccessCode(entry, email, callerIp(request.headers))
    return backToGate(entry.slug, request, next, { email, error: outcome === 'limited' ? 'limited' : undefined })
}

async function checkCode(entry: PublishedEntry, request: Request): Promise<Response> {
    const form = await formOf(request)
    const next = safeNextPath(form?.get('next')?.toString())
    const email = normalizedEmail(form?.get('email')?.toString())
    if (!email) return backToGate(entry.slug, request, next, { error: 'email' })
    const outcome = await verifyAccessCode(entry, email, form?.get('code')?.toString() ?? '', callerIp(request.headers))
    if (outcome !== 'ok') return backToGate(entry.slug, request, next, { email, error: outcome === 'limited' ? 'limited' : 'code' })
    return intoPage(entry.slug, request, next, entry, 'invite', email)
}

// Reachable on the app host by its internal path too, where agent HTML must never run.
async function resolve(request: Request, { params }: Params): Promise<{ entry: PublishedEntry | null; slug: string; path: string[] } | null> {
    const { slug, path = [] } = await params
    if (extractPublishedSlug(request.headers.get('host')) !== slug) return null
    return { entry: await loadPublished(slug), slug, path }
}

function reserved(path: string[]): string | null {
    return path[0] === '__rerun' ? path.slice(1).join('/') : null
}

export async function GET(request: Request, context: Params): Promise<Response> {
    const target = await resolve(request, context)
    if (!target) return notFound()
    const { entry, path } = target
    const action = reserved(path)

    if (action === 'logout') return seeOther(new URL('/', originOf(target.slug, request)).toString(), clearAccessCookieHeader(isSecureRequest(request)))
    if (!entry) return notFound()
    if (action === 'og.png') return serveOgImage(entry)
    if (action === 'auth') return redeemTicket(entry, request)

    const allowed = mayOpen(entry, readAccessCookie(request.headers.get('cookie'), isSecureRequest(request)))
    if (!allowed) return notFound()
    if (action === 'raw') return serveRaw(entry, request)
    if (action !== null) return notFound()
    return serveContent(entry, request, path)
}

export async function POST(request: Request, context: Params): Promise<Response> {
    const target = await resolve(request, context)
    if (!target?.entry) return notFound()
    switch (reserved(target.path)) {
        case 'password':
            return checkPassword(target.entry, request)
        case 'code/send':
            return sendCode(target.entry, request)
        case 'code/verify':
            return checkCode(target.entry, request)
        default:
            return notFound()
    }
}
