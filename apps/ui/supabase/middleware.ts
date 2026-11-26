import type { Database } from '@/app/api/database.types'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import type { HostSite } from '@/lib/brand/site'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { REFERRAL_COOKIE, REFERRAL_PATH } from '@/ee/lib/billing/referral'
import { drawPriceArm } from '@rerun/cloud/billing'
import { joinOrganization, reachesBeyondOrganization } from '@rerun/cloud/organizations.server'
import { internalPath } from '@/lib/auth/internal-path'
import { asksSecondStep, awaitsSecondStep, hasTwoStep, sessionLevel, tokenHasTwoStep, TWO_STEP_PATH } from '@/lib/auth/two-step/gate'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { requestHost, requestProtocol } from '@/lib/request-host'
import { MOVED_PARAM } from '@/lib/brand/host-paths'
import { routes } from '@/lib/routes'
import { EXPERIMENT_COOKIE } from '@rerun/analytics/experiments'
import { CONSENT_COOKIE, DESKTOP_AUTH_PATH, SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE, parseSessionHintCookie } from '@rerun/contracts'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { LOCALE_COOKIE, resolveLocale } from '@rerun/i18n'
import { NextResponse, type NextRequest } from 'next/server'

// Every page of the app needs an account. These are the ones a visitor without a session may open:
// the sign-in itself, and the doors that bring someone to it with something to join (a workspace or a
// team invitation, a creator invite, an AppSumo code, a friend's referral link) or to leave (an
// unsubscribe link). Everything outside the matcher of proxy.ts (published pages, the OG renders, the public and
// mobile APIs) never gets here.
// The start and the callbacks of an app's sign-in check for themselves who they are for: the browser an
// organization's address sends here has no session on this one.
const SELF_CHECKED_PATHS = ['/api/oauth/host', '/api/oauth/claim', '/api/oauth/managed', '/api/mcp/oauth']
const PUBLIC_PATHS = [...SELF_CHECKED_PATHS, routes.auth, '/invite', '/organization/invite', '/redeem', '/creator/join', '/unsubscribe', REFERRAL_PATH]

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

// A token issued while the account had two-step on, read once the auth server vouched for its user.
async function tokenOutlivedTwoStep(supabase: SupabaseClient<Database>): Promise<boolean> {
    try {
        return tokenHasTwoStep((await supabase.auth.getSession()).data.session?.access_token)
    } catch {
        return false
    }
}

// A method that a setup cut short left without the flag: the flag goes in now, and into this session's
// token, so what reads the token alone (navigations, the database's policies) holds the session too.
// The Security tab then finishes the setup (recovery factor, backup codes) once the session is at aal2.
async function flagCutShortSetup(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
    try {
        const { error } = await createServiceRoleClient().auth.admin.updateUserById(userId, { app_metadata: { two_step: true } })
        if (error) throw error
        await supabase.auth.refreshSession()
    } catch (err) {
        console.error('[two-step] flag of a cut-short setup not written', err instanceof Error ? err.message : err)
    }
}

// The second step, with where they were going: from the sign-in, where it was headed. The desktop
// app's hand-off is a destination of its own, with its challenge in the query.
function secondStepUrl(request: NextRequest): string {
    const { pathname, search, searchParams } = request.nextUrl
    const fromSignIn = pathname.startsWith(routes.auth) && pathname !== DESKTOP_AUTH_PATH
    const back = fromSignIn ? internalPath(searchParams.get('next'), routes.home) : `${pathname}${search}`
    return back === routes.home ? TWO_STEP_PATH : `${TWO_STEP_PATH}?next=${encodeURIComponent(back)}`
}

// The sign-in of the address Rerun answers for, with where they were going and why they are sent there.
function signInOnDefaultAddress(request: NextRequest, defaultOrigin: string): string {
    const url = new URL(routes.auth, defaultOrigin)
    url.searchParams.set(MOVED_PARAM, '1')
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`
    if (back !== routes.home) url.searchParams.set('next', back)
    return url.toString()
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
    const host = (requestHost(request.headers) ?? request.nextUrl.hostname).split(':')[0]
    return host.endsWith('rerun.build') ? '.rerun.build' : undefined
}

// The reverse proxy (Traefik, under Dokploy) terminates the TLS and forwards the request in clear: without the forwarded header the
// cookie would go out without `Secure` in production.
function isSecure(request: NextRequest): boolean {
    return requestProtocol(request.headers, request.nextUrl.protocol === 'https:' ? 'https' : 'http') === 'https'
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

// A page, loaded by the browser or fetched by the router, as opposed to a call, an action or a form.
function isPage(request: NextRequest): boolean {
    return request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/')
}

const INVITE_PATHS = ['/invite/', '/organization/invite/', '/creator/join', '/redeem']

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

type Provisioned = { signedUp: boolean } | null

// A read that failed lets the page through: it is asked again on the next one.
async function worksElsewhere(userId: string, organizationId: string): Promise<boolean> {
    return reachesBeyondOrganization(userId, organizationId).catch(err => {
        console.error('[organizations] could not tell where else an account works', err)
        return false
    })
}

async function provision(request: NextRequest, supabase: SupabaseClient<Database>, user: User, site: HostSite): Promise<Provisioned> {
    const locale = resolveLocale({ cookie: request.cookies.get(LOCALE_COOKIE)?.value, acceptLanguage: request.headers.get('accept-language') })
    if (site.kind === 'organization') return joinOrganization(user, site.organizationId, { locale })
    return provisionUser(supabase, user, {
        phoneStep: !arrivesByInvite(request),
        priceArm: drawPriceArm({
            experimentCookie: request.cookies.get(EXPERIMENT_COOKIE)?.value,
            consentCookie: request.cookies.get(CONSENT_COOKIE)?.value,
            userAgent: request.headers.get('user-agent'),
        }),
        locale,
        referralCode: request.cookies.get(REFERRAL_COOKIE)?.value,
    })
}

export async function updateSession(request: NextRequest, site: HostSite = { kind: 'rerun' }) {
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
    let pendingSecondStep = false
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
        pendingSecondStep = !!identity && awaitsSecondStep(data?.claims.app_metadata, data?.claims.aal)
    }
    // The account says whether it asks for a second step, from the moment the flag is written, and
    // even before it is when a setup was cut short after its method was confirmed.
    if (user && asksSecondStep(user)) {
        if (!hasTwoStep(user.app_metadata)) await flagCutShortSetup(supabase, user.id)
        pendingSecondStep = (await sessionLevel(supabase)) !== 'aal2'
    }
    // Two-step turned off since this token was issued: the database still reads the flag in it and
    // would answer nothing, so the session takes a fresh token now rather than within the hour.
    else if (user && (await tokenOutlivedTwoStep(supabase))) await supabase.auth.refreshSession()

    identity ??= user ? { id: user.id } : null

    // A session is the same on every address, and a domain of an organization's own answers wherever
    // its DNS says: an account that also works elsewhere never keeps one there. Closed on this address
    // alone, and they sign in on the one Rerun answers for.
    // The router's own fetch of a page cannot follow a redirect to another address: it falls back on
    // loading that page, and that load is what closes the session and takes them there.
    if (identity && site.kind === 'organization' && site.defaultOrigin && isPage(request) && (await worksElsewhere(identity.id, site.organizationId))) {
        if (isPageLoad(request)) await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        return redirectKeepingSession(request, signInOnDefaultAddress(request, site.defaultOrigin), supabaseResponse)
    }

    // An account with two-step already exists, and before its second step the database answers it
    // nothing: provisioning would read it as new.
    let provisioned: Provisioned = null
    if (identity && !pendingSecondStep && provisioningNeeded(request.cookies.get(PROVISIONED_COOKIE)?.value, identity)) {
        user ??= (await supabase.auth.getUser()).data.user
        if (user) {
            provisioned = await provision(request, supabase, user, site)
        }
    }

    // After every auth call, never before: `setAll` rebuilds `supabaseResponse` from scratch on a
    // token refresh, and a cookie written earlier would go down with the old object. Both early
    // returns below carry them over through `redirectKeepingSession`.
    applySessionHint(request, supabaseResponse, !!identity)
    if (identity && provisioned) applyProvisionedCookie(request, supabaseResponse, identity, provisioned.signedUp)
    // Read once, at the birth of the account: an account that already existed never becomes a friend.
    if (identity && provisioned && request.cookies.has(REFERRAL_COOKIE)) supabaseResponse.cookies.delete(REFERRAL_COOKIE)

    const { pathname } = request.nextUrl
    if (identity && pendingSecondStep) {
        // Signed in with the first method only: every page waits behind the second step. Calls and
        // actions go on to their own checks, which take such a session for nobody.
        if (isPage(request) && pathname !== TWO_STEP_PATH && pathname !== routes.authCallback) {
            return redirectKeepingSession(request, secondStepUrl(request), supabaseResponse)
        }
    } else if (identity) {
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
