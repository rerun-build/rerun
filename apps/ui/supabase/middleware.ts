import type { Database } from '@/app/api/database.types'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { drawPriceArm } from '@rerun/cloud/billing'
import { routes } from '@/lib/routes'
import { EXPERIMENT_COOKIE } from '@rerun/analytics/experiments'
import { CONSENT_COOKIE, DESKTOP_AUTH_PATH, SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE, parseDesktopShellUserAgent, parseSessionHintCookie } from '@rerun/contracts'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { LOCALE_COOKIE, resolveLocale } from '@rerun/i18n'
import { NextResponse, type NextRequest } from 'next/server'

// A visitor with no session gets an anonymous Supabase user so they can explore the app without
// signing up. We only mint one for real top-level navigations (a document GET outside /auth), never
// for prefetches, RSC fetches, assets or API calls, to avoid spawning throwaway users on every hit.
// The desktop app never gets one: it opens on the sign-in page, and an anonymous workspace minted
// for its window would be one nobody can reach again from the browser.
function shouldStartAnonymousSession(request: NextRequest): boolean {
    if (request.method !== 'GET') return false
    if (request.headers.get('sec-fetch-dest') !== 'document') return false
    if (request.nextUrl.pathname.startsWith(routes.auth)) return false
    if (parseDesktopShellUserAgent(request.headers.get('user-agent'))) return false
    return true
}

// A redirect response is built from scratch, so it does not inherit the refreshed session cookies
// `setAll` wrote on `supabaseResponse`. Leaving them behind hands the browser back a refresh token
// the server has already rotated away, and the next request logs the user out.
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

// The reverse proxy (Traefik, under Dokploy) terminates the TLS and forwards the request in clear: without the forwarded header the
// cookie would go out without `Secure` in production.
function isSecure(request: NextRequest): boolean {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    return (forwarded ?? request.nextUrl.protocol.replace(':', '')) === 'https'
}

// The landing reads this one with an inline script before its first paint, so it stays out of
// `httpOnly`. It says nothing a visitor does not already know about themselves. Written on page
// loads only: a cookie set by the middleware on a server action makes Next refresh the router after
// it, and the hint has nothing to learn from an action.
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

// Who the request comes from, as far as the middleware needs to know.
type Identity = { id: string; isAnonymous: boolean }

// A page load is where a revoked session gets caught, so it asks the auth server. Everything else a
// page sends (a server action, an RSC fetch, an API call) verifies the JWT locally against the
// project's signing keys: valid and unexpired, with the revocation check left to the next page load.
// That round-trip used to sit in front of every action the board queued.
function isPageLoad(request: NextRequest): boolean {
    return request.headers.get('sec-fetch-dest') === 'document'
}

const INVITE_PATHS = ['/invite/', '/creator/join', '/redeem']

// Whoever signs up through a workspace invite or a creator invite joins something that already
// exists, and is not asked for a phone number, nor is whoever comes to redeem a code they paid
// AppSumo for. These pages set the cookie on their way to /auth, but the Google callback and the
// email button clear it as they redirect back, so the first request that carries the new account
// is recognised by where it lands as well.
export function arrivesByInvite(request: NextRequest): boolean {
    return request.cookies.has(PENDING_INVITE_COOKIE) || INVITE_PATHS.some(path => request.nextUrl.pathname.startsWith(path))
}

const PROVISIONED_COOKIE = 'rerun-provisioned'
const PROVISIONED_MAX_AGE = 30 * 24 * 60 * 60

// `<user id>.<1 once signed_up_at is set, else 0>`, written once provisioning went through. It only
// spares the read: a forged or stale one skips provisioning for its own holder and nobody else.
export function provisioningNeeded(cookie: string | undefined, identity: Identity): boolean {
    const [id, stamped] = (cookie ?? '').split('.')
    if (id !== identity.id) return true
    // An anonymous visitor has nothing left to stamp; the conversion to an account flips the JWT
    // and brings the provisioning back for the one request that stamps it.
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
                // `options` carries the 400-day `maxAge` on a write and `maxAge: 0` on the removal of a
                // stale chunk. Dropping it turns the auth cookie into a session cookie, which every
                // refresh then re-downgrades, and turns a chunk removal into an empty cookie that
                // survives and corrupts the next read.
                cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
            },
        },
    })

    // Do not run code between createServerClient and the session check below (getUser or
    // getClaims, both refresh an expired token). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    // IMPORTANT: DO NOT REMOVE the session check

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

    // After every auth call, never before: `setAll` rebuilds `supabaseResponse` from scratch on a
    // token refresh, and a cookie written earlier would go down with the old object. Both early
    // returns below carry them over through `redirectKeepingSession`.
    applySessionHint(request, supabaseResponse, !!identity && !identity.isAnonymous)
    if (identity && provisioned) applyProvisionedCookie(request, supabaseResponse, identity, provisioned.signedUp)

    if (identity) {
        // Only real (converted) users are bounced away from /auth. Anonymous users must keep access
        // to /auth so they can sign in or upgrade their account.
        // The callback is let through: connecting Google from the account settings comes back to it
        // signed in, and the code it carries is only exchanged there.
        // So is the desktop app's hand-off, which a signed-in browser opens to sign the app in.
        if (!identity.isAnonymous && request.nextUrl.pathname.startsWith(routes.auth) && request.nextUrl.pathname !== routes.authCallback && request.nextUrl.pathname !== DESKTOP_AUTH_PATH) {
            return redirectKeepingSession(request, routes.home, supabaseResponse)
        }
    } else if (request.nextUrl.pathname === routes.home) {
        // Fallback when no anonymous session could be minted (anonymous sign-ins disabled or failed):
        // keep the previous behaviour and send visitors to the auth page.
        return redirectKeepingSession(request, routes.auth, supabaseResponse)
    }

    // IMPORTANT: You *must* return the supabaseResponse object as it is.
    // If you're creating a new response object with NextResponse.next() make sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid changing
    //    the cookies!
    // 4. Finally:
    //    return myNewResponse
    // If this is not done, you may be causing the browser and server to go out
    // of sync and terminate the user's session prematurely!

    return supabaseResponse
}
