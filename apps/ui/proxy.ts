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
import { extractPublishedSlug, PUBLISHED_SITE_ROUTE } from '@/lib/published/host'
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
} from '@moldwright/contracts'
import { NextRequest, NextResponse } from 'next/server'

function brandGate(request: NextRequest): NextResponse {
    const secret = process.env.BRAND_GATE_TOKEN
    const verdict = brandGateVerdict({
        secret,
        param: request.nextUrl.searchParams.get(BRAND_GATE_PARAM),
        cookie: request.cookies.get(BRAND_GATE_COOKIE)?.value,
        production: process.env.NODE_ENV === 'production',
    })

    if (verdict === 'deny') return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

    const response = NextResponse.next()
    if (verdict === 'grant' && secret) {
        const host = (request.headers.get('host') ?? request.nextUrl.hostname).split(':')[0]
        const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
        response.cookies.set(BRAND_GATE_COOKIE, secret, {
            path: '/',
            maxAge: BRAND_GATE_MAX_AGE,
            sameSite: 'lax',
            domain: host.endsWith('rerun.build') ? '.rerun.build' : undefined,
            secure: (forwarded ?? request.nextUrl.protocol.replace(':', '')) === 'https',
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

export async function proxy(request: NextRequest) {
    const publishedSlug = extractPublishedSlug(request.headers.get('host'))
    if (publishedSlug) return publishedHost(request, publishedSlug)

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

    return updateSession(withDesktopShellPreview(request))
}

function withDesktopShellPreview(request: NextRequest): NextRequest {
    const platform = request.nextUrl.searchParams.get(DESKTOP_SHELL_PREVIEW_PARAM)
    if (!platform || request.headers.get('sec-fetch-dest') !== 'iframe' || !(DESKTOP_SHELL_PLATFORMS as readonly string[]).includes(platform)) return request
    const headers = new Headers(request.headers)
    headers.set(DESKTOP_SHELL_PREVIEW_HEADER, platform)
    return new NextRequest(request, { headers })
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|api/version|api/desktop/config|api/t/|api/files|api/llm/|api/v1/|api/host-metrics|api/public/|og/|render/|email/|r/|p/|published-auth|desktop-view|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
        '/render/lab',
        '/render/lab/:path*',
        { source: '/:path*', has: [{ type: 'host', value: '.+\\.rerun\\.site' }] },
        { source: '/:path*', has: [{ type: 'host', value: '.+\\.localhost' }] },
    ],
}
