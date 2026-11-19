import type { Database } from '@/app/api/database.types'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { drawPriceArm } from '@moldwright/cloud/billing'
import { routes } from '@/lib/routes'
import { EXPERIMENT_COOKIE } from '@moldwright/analytics/experiments'
import { CONSENT_COOKIE, DESKTOP_AUTH_PATH, SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE, parseDesktopShellUserAgent, parseSessionHintCookie } from '@moldwright/contracts'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { LOCALE_COOKIE, resolveLocale } from '@moldwright/i18n'
import { NextResponse, type NextRequest } from 'next/server'

function shouldStartAnonymousSession(request: NextRequest): boolean {
    if (request.method !== 'GET') return false
    if (request.headers.get('sec-fetch-dest') !== 'document') return false
    if (request.nextUrl.pathname.startsWith(routes.auth)) return false
    if (parseDesktopShellUserAgent(request.headers.get('user-agent'))) return false
    return true
}

function redirectKeepingSession(request: NextRequest, pathname: string, sessionResponse: NextResponse): NextResponse {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const response = NextResponse.redirect(url)
    sessionResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
}

function cookieDomain(request: NextRequest): string | undefined {
    const host = (request.headers.get('host') ?? request.nextUrl.hostname).split(':')[0]
    return host.endsWith('rerun.build') ? '.rerun.build' : undefined
}

function isSecure(request: NextRequest): boolean {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    return (forwarded ?? request.nextUrl.protocol.replace(':', '')) === 'https'
}

function applySessionHint(request: NextRequest, response: NextResponse, signedIn: boolean): void {
    if (!isPageLoad(request)) return
    if (!signedIn && !parseSessionHintCookie(request.cookies.get(SESSION_HINT_COOKIE)?.value)) return
    response.cookies.set(SESSION_HINT_COOKIE, SESSION_HINT_VALUE, {
        path: '/',
        maxAge: signedIn ? SESSION_HINT_MAX_AGE : 0,
        sameSite: 'lax',
        domain: cookieDomain(request),
        secure: isSecure(request),
        httpOnly: false,
    })
}

type Identity = { id: string; isAnonymous: boolean }

function isPageLoad(request: NextRequest): boolean {
    return request.headers.get('sec-fetch-dest') === 'document'
}

const INVITE_PATHS = ['/invite/', '/creator/join', '/redeem']

export function arrivesByInvite(request: NextRequest): boolean {
    return request.cookies.has(PENDING_INVITE_COOKIE) || INVITE_PATHS.some(path => request.nextUrl.pathname.startsWith(path))
}

const PROVISIONED_COOKIE = 'rerun-provisioned'
const PROVISIONED_MAX_AGE = 30 * 24 * 60 * 60

export function provisioningNeeded(cookie: string | undefined, identity: Identity): boolean {
    const [id, stamped] = (cookie ?? '').split('.')
    if (id !== identity.id) return true
    if (identity.isAnonymous) return false
    return stamped !== '1'
}

function applyProvisionedCookie(request: NextRequest, response: NextResponse, identity: Identity, signedUp: boolean): void {
    response.cookies.set(PROVISIONED_COOKIE, `${identity.id}.${signedUp ? 1 : 0}`, { path: '/', maxAge: PROVISIONED_MAX_AGE, sameSite: 'lax', secure: isSecure(request), httpOnly: true })
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        cookies: {
            getAll() {
                return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                supabaseResponse = NextResponse.next({
                    request,
                })
                cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
            },
        },
    })

    let user: User | null = null
    let identity: Identity | null = null
    if (isPageLoad(request)) {
        user = (await supabase.auth.getUser()).data.user
    } else {
        const { data } = await supabase.auth.getClaims()
        if (data?.claims.sub) identity = { id: data.claims.sub, isAnonymous: data.claims.is_anonymous === true }
    }

    if (!user && !identity && shouldStartAnonymousSession(request)) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) console.error('Anonymous sign-in failed', error.message)
        user = data.user
    }

    identity ??= user ? { id: user.id, isAnonymous: !!user.is_anonymous } : null

    let provisioned: { signedUp: boolean } | null = null
    if (identity && provisioningNeeded(request.cookies.get(PROVISIONED_COOKIE)?.value, identity)) {
        user ??= (await supabase.auth.getUser()).data.user
        if (user) {
            provisioned = await provisionUser(supabase, user, {
                phoneStep: !arrivesByInvite(request),
                priceArm: drawPriceArm({
                    experimentCookie: request.cookies.get(EXPERIMENT_COOKIE)?.value,
                    consentCookie: request.cookies.get(CONSENT_COOKIE)?.value,
                    userAgent: request.headers.get('user-agent'),
                }),
                locale: resolveLocale({ cookie: request.cookies.get(LOCALE_COOKIE)?.value, acceptLanguage: request.headers.get('accept-language') }),
            })
        }
    }

    applySessionHint(request, supabaseResponse, !!identity && !identity.isAnonymous)
    if (identity && provisioned) applyProvisionedCookie(request, supabaseResponse, identity, provisioned.signedUp)

    if (identity) {
        if (!identity.isAnonymous && request.nextUrl.pathname.startsWith(routes.auth) && request.nextUrl.pathname !== routes.authCallback && request.nextUrl.pathname !== DESKTOP_AUTH_PATH) {
            return redirectKeepingSession(request, routes.board, supabaseResponse)
        }
    } else if (request.nextUrl.pathname === routes.home || request.nextUrl.pathname === routes.board) {
        return redirectKeepingSession(request, routes.auth, supabaseResponse)
    }

    return supabaseResponse
}
