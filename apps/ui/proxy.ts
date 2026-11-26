import {
    GATE_EMAIL_PARAM,
    GATE_ERROR_PARAM,
    isSecureRequest,
    loadPublished,
    mayOpen,
    opensInViewer,
    PUBLISHED_GATE_ROUTE,
    PUBLISHED_VIEW_ROUTE,
    readAccessCookie,
    RESERVED_PREFIX,
    siteFileExists,
} from '@/lib/published/gate'
import { HOST_UNAVAILABLE_ROUTE, isRerunOnlyPath } from '@/lib/brand/host-paths'
import { organizationRootDomain } from '@/lib/brand/root-domain'
import { hostSite } from '@/lib/brand/site'
import { PUBLISHED_SITE_ROUTE } from '@/lib/published/host'
import { requestHost, requestProtocol } from '@/lib/request-host'
import { PAGE_HEADER } from '@/lib/workspace/workspace-header'
import { STAGING_GATE_CHALLENGE, stagingGateVerdict } from '@/lib/staging-gate'
import { updateSession } from '@/supabase/middleware'
import { DESKTOP_SHELL_PREVIEW_HEADER, DESKTOP_SHELL_PREVIEW_PARAM } from '@/lib/desktop-shell/preview'
import {
    APP_GATED_PATHS,
    DESKTOP_SHELL_PLATFORMS,
    BRAND_GATE_COOKIE,
    BRAND_GATE_MAX_AGE,
    BRAND_GATE_PARAM,
    brandGateVerdict,
    isGatedPath,
} from '@rerun/contracts'
import { NextRequest, NextResponse } from 'next/server'

const notFoundResponse = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

// The labs are work in progress, so they answer 404 unless the request carries the shared design
// system token, as `?key=` or in the cookie that grants it. Same token and same cookie as the
// landing, set on `.rerun.build`: unlocking once opens both hosts. The UI kit next to them is public.
// No Supabase session is read here, so a capture of these pages still provisions nothing, which is
// what excluding `render/` from the matcher below exists for.
function brandGate(request: NextRequest): NextResponse {
    const secret = process.env.BRAND_GATE_TOKEN
    const verdict = brandGateVerdict({
        secret,
        param: request.nextUrl.searchParams.get(BRAND_GATE_PARAM),
        cookie: request.cookies.get(BRAND_GATE_COOKIE)?.value,
        production: process.env.NODE_ENV === 'production',
    })

    if (verdict === 'deny') return notFoundResponse()

    const response = NextResponse.next()
    if (verdict === 'grant' && secret) {
        const host = (requestHost(request.headers) ?? request.nextUrl.hostname).split(':')[0]
        response.cookies.set(BRAND_GATE_COOKIE, secret, {
            path: '/',
            maxAge: BRAND_GATE_MAX_AGE,
            sameSite: 'lax',
            domain: host.endsWith('rerun.build') ? '.rerun.build' : undefined,
            secure: requestProtocol(request.headers, request.nextUrl.protocol === 'https:' ? 'https' : 'http') === 'https',
        })
    }
    return response
}

function rewriteTo(request: NextRequest, pathname: string, params: Record<string, string> = {}, status?: number): NextResponse {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return NextResponse.rewrite(url, status ? { status } : undefined)
}

// A published host answers before anything reads or writes a session: rerun.site never provisions
// an anonymous user for every visitor of a shared link, and the only cookie it ever holds is the
// one its own gate sets. The link decides what a path shows: the site's file, the viewer of a single
// file, or the gate when the visitor may not open it yet. The reserved `/__rerun/` paths (the gate's
// forms, the raw file, the preview image) always reach the route, which checks for itself, and the
// app's own `/_next/` assets serve the gate and the viewer unless the site has a file of that name.
async function publishedHost(request: NextRequest, slug: string): Promise<NextResponse> {
    const { pathname } = request.nextUrl
    if (pathname.startsWith(RESERVED_PREFIX)) return rewriteTo(request, `${PUBLISHED_SITE_ROUTE}/${slug}${pathname}`)

    const entry = await loadPublished(slug)
    if (pathname.startsWith('/_next/') && !(entry && siteFileExists(entry, pathname))) return NextResponse.next()
    if (!entry) return rewriteTo(request, `${PUBLISHED_GATE_ROUTE}/${slug}`, { gate: 'gone' }, 404)

    if (!mayOpen(entry, readAccessCookie(request.headers.get('cookie'), isSecureRequest(request)))) {
        const next = new URL(request.nextUrl)
        next.searchParams.delete(GATE_ERROR_PARAM)
        next.searchParams.delete(GATE_EMAIL_PARAM)
        return rewriteTo(request, `${PUBLISHED_GATE_ROUTE}/${slug}`, { gate: entry.access, next: `${next.pathname}${next.search}` })
    }
    if (pathname === '/' && opensInViewer(entry)) return rewriteTo(request, `${PUBLISHED_VIEW_ROUTE}/${slug}`)
    return rewriteTo(request, `${PUBLISHED_SITE_ROUTE}/${slug}${pathname}`)
}

// Whose app the host is decides before anything else: a page published by a coworker, an
// organization's app, or Rerun's. A name pointed here that is nobody's gets nothing, never a sign-in.
export async function proxy(request: NextRequest) {
    const site = await hostSite(requestHost(request.headers) ?? request.nextUrl.host)
    if (site.kind === 'published') return publishedHost(request, site.slug)
    if (site.kind === 'unknown') return notFoundResponse()
    if (site.kind === 'organization') {
        if (isRerunOnlyPath(request.nextUrl.pathname)) return notFoundResponse()
        if (site.suspended) return unavailableHost(request)
    }

    if (isGatedPath(request.nextUrl.pathname, APP_GATED_PATHS)) return brandGate(request)

    const stagingGate = stagingGateVerdict({
        password: process.env.STAGING_PASSWORD,
        authorization: request.headers.get('authorization'),
        pathname: request.nextUrl.pathname,
    })
    if (stagingGate === 'deny') {
        return new NextResponse('Authentication required', {
            status: 401,
            headers: { 'WWW-Authenticate': STAGING_GATE_CHALLENGE, 'Cache-Control': 'no-store' },
        })
    }

    const response = await updateSession(markPage(withDesktopShellPreview(request)), site)
    // Nobody frames an organization's app but itself: its address is the only sign of whose it is.
    if (site.kind === 'organization' && !request.nextUrl.pathname.startsWith('/api/')) response.headers.set('Content-Security-Policy', "frame-ancestors 'self'")
    return response
}

// The organization exists, its name is said and nothing else opens.
function unavailableHost(request: NextRequest): NextResponse {
    if (request.method !== 'GET' || request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unavailable' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    return rewriteTo(request, HOST_UNAVAILABLE_ROUTE, {}, 403)
}

// Only where organizations are served: there, what a page opens on depends on the host it opens on.
function markPage(request: NextRequest): NextRequest {
    if (!organizationRootDomain()) return request
    if (request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/')) request.headers.set(PAGE_HEADER, '1')
    else request.headers.delete(PAGE_HEADER)
    return request
}

// The lab of the desktop chrome (/render/lab/desktop-shell) frames the app in iframes: the app there
// renders as it does inside the desktop app, for the platform the lab asks for. Only an iframe asks:
// a page opened with the parameter renders as a browser.
function withDesktopShellPreview(request: NextRequest): NextRequest {
    const platform = request.nextUrl.searchParams.get(DESKTOP_SHELL_PREVIEW_PARAM)
    if (!platform || request.headers.get('sec-fetch-dest') !== 'iframe' || !(DESKTOP_SHELL_PLATFORMS as readonly string[]).includes(platform)) return request
    const headers = new Headers(request.headers)
    headers.set(DESKTOP_SHELL_PREVIEW_HEADER, platform)
    return new NextRequest(request, { headers })
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - og/ and render/ (OG images and the pages the screenshot service captures: a headless
         *   navigation sends `sec-fetch-dest: document`, which would provision an anonymous user
         *   and a workspace on every capture)
         * - api/t/ (public webhook triggers, for the same reason: a GET trigger opened in a browser
         *   or unfurled by Slack would provision a user and a workspace on every link preview)
         * - api/files (uploads: Next tees the request body to hand it to the middleware, and truncates
         *   it at 10MB doing so, which silently corrupted every upload past that. The tee also buffers
         *   the whole body in memory, so streaming a file through is only possible from outside the
         *   matcher. These routes authenticate themselves through requireWorkspaceId().)
         * - api/llm (the boxes' model proxy, for the same 10MB truncation: an image a box hands its
         *   model travels inline in base64, and a cut body reached the route as "Invalid JSON". The
         *   caller is an engine with its key, never a browser with a session to refresh.)
         * - api/v1 (the mobile API: callers send a bearer token, never a cookie, so there is no
         *   session to refresh, and each route authenticates itself through apiRoute())
         * - email/ (artwork fetched by mail clients and image proxies, same reason again)
         * - r/ (the affiliate pixel and its API proxy: a tracking beacon has no session to
         *   refresh, and it fires on every page)
         * - api/host-metrics (the Incus hosts push their samples with a bearer token, once a minute
         *   each: there is no session to refresh)
         * - api/public/ (what the landing page asks of the app from another origin, without a cookie:
         *   there is no session to refresh)
         * - p/ (published file links: opened by whoever the link was shared with, who has no session
         *   to refresh, and would otherwise each get an anonymous user and a workspace)
         * - published-auth (the round trip a member makes to open a page of their workspace on its
         *   published host: a visitor without a session is sent to sign in, never handed one)
         * - desktop-view (the screen of a coworker in the iOS app's web view: the ticket in its
         *   fragment is the only key, there is no session to refresh nor one to provision)
         * - api/edge (asked by the edge before it gets a certificate, with a key of its own)
         * - api/desktop/config (asked by the desktop app before it shows the server, staging
         *   included: it carries no session and must answer before anyone signs in)
         * - .well-known/ (the files Apple and Google read to let the mobile app use passkeys on this
         *   domain: fetched by their servers, with no session)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|\\.well-known/|api/version|api/desktop/config|api/t/|api/files|api/llm/|api/v1/|api/host-metrics|api/edge/|api/public/|og/|render/|email/|r/|p/|published-auth|desktop-view|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
        // The labs put back in, for the gate alone: proxy() returns before it ever reaches
        // updateSession(). The UI kit (/render/kit) and the OG renders, /render/brand and
        // /render/templates, stay out: the screenshot service captures those on every card.
        '/render/lab',
        '/render/lab/:path*',
        // Every path of a published site, images and favicon.ico included, which the exclusions
        // above would otherwise hand to the app's own files instead of the site's.
        { source: '/:path*', has: [{ type: 'host', value: '.+\\.rerun\\.site' }] },
        { source: '/:path*', has: [{ type: 'host', value: '.+\\.localhost' }] },
    ],
}
