import type { Database } from '@/app/api/database.types'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { drawPriceArm } from '@rerun/cloud/billing'
import { internalPath } from '@/lib/auth/internal-path'
import { routes } from '@/lib/routes'
import { EXPERIMENT_COOKIE } from '@rerun/analytics/experiments'
import { CONSENT_COOKIE, DESKTOP_AUTH_PATH, SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE, parseSessionHintCookie } from '@rerun/contracts'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { LOCALE_COOKIE, resolveLocale } from '@rerun/i18n'
import { NextResponse, type NextRequest } from 'next/server'

// Every page of the app needs an account. These are the ones a visitor without a session may open:
// the sign-in itself, and the doors that bring someone to it with something to join (a workspace
// invitation, a creator invite, an AppSumo code) or to leave (an unsubscribe link). Everything outside
// the matcher of proxy.ts (published pages, the OG renders, the public and mobile APIs) never gets here.
const PUBLIC_PATHS = [routes.auth, '/invite', '/redeem', '/creator/join', '/unsubscribe']

export function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

// Sends a visitor to the sign-in with where they were going, query included: `/?template=x` comes
// back as `/?template=x` once they have an account and have gone through the onboarding.
function redirectToSignIn(request: NextRequest, sessionResponse: NextResponse): NextResponse {
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`
    const url = request.nextUrl.clone()
    url.pathname = routes.auth
    url.search = ''
    if (back !== routes.home) url.searchParams.set('next', back)
    const response = NextResponse.redirect(url)
    sessionResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie))
    return response
}

// A redirect response is built from scratch, so it does not inherit the refreshed session cookies
// `setAll` wrote on `supabaseResponse`. Leaving them behind hands the browser back a refresh token
// the server has already rotated away, and the next request logs the user out.
function redirectKeepingSession(request: NextRequest, target: string, sessionResponse: NextResponse): NextResponse {
    const url = new URL(target, request.nextUrl)
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
type Identity = { id: string }

// A page load is where a revoked session gets caught, so it asks the auth server. Everything else a
// page sends (a server action, an RSC fetch, an API call) verifies the JWT locally against the
// project's signing keys: valid and unexpired, with the revocation check left to the next page load.
// That round-trip used to sit in front of every action the board queued.
//
// A browser that predates Sec-Fetch-Dest (Safari before 16.4, older webviews) is told apart by what
// a navigation asks for: HTML, in a GET. The router's own fetches ask for `*/*`, and Next strips
// their `rsc` headers before this runs, so the Accept header is the only thing left to read.
function isPageLoad(request: NextRequest): boolean {
    const destination = request.headers.get('sec-fetch-dest')
    if (destination) return destination === 'document'
    return request.method === 'GET' && (request.headers.get('accept')?.includes('text/html') ?? false)
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
    return id !== identity.id || stamped !== '1'
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
        // Visitors used to get an anonymous session; one still valid is closed on its next page
        // load, and they sign in like everyone else.
        if (user?.is_anonymous) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
            user = null
        }
    } else {
        const { data } = await supabase.auth.getClaims()
        if (data?.claims.sub && data.claims.is_anonymous !== true) identity = { id: data.claims.sub }
    }

    identity ??= user ? { id: user.id } : null

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
    applySessionHint(request, supabaseResponse, !!identity)
    if (identity && provisioned) applyProvisionedCookie(request, supabaseResponse, identity, provisioned.signedUp)

    const { pathname } = request.nextUrl
    if (identity) {
        // A signed-in visit to the sign-in goes where it was headed. The callback is let through:
        // connecting Google from the account settings comes back to it signed in, and the code it
        // carries is only exchanged there. So is the desktop app's hand-off, which a signed-in
        // browser opens to sign the app in.
        if (pathname.startsWith(routes.auth) && pathname !== routes.authCallback && pathname !== DESKTOP_AUTH_PATH) {
            return redirectKeepingSession(request, internalPath(request.nextUrl.searchParams.get('next'), routes.home), supabaseResponse)
        }
    } else if (isPageLoad(request) && request.method === 'GET' && !isPublicPath(pathname)) {
        return redirectToSignIn(request, supabaseResponse)
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
