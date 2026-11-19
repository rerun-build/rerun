import type { Database } from '@/app/api/database.types'
import { LAST_SIGN_IN_COOKIE, LAST_SIGN_IN_MAX_AGE_SECONDS } from '@/lib/auth/last-sign-in-cookie'
import { ACCOUNT_LINK_ERROR_PARAM, ACCOUNT_LINK_PROVIDER_PARAM, ACCOUNT_PARAM, LINK_INTENT_COOKIE } from '@/lib/auth/link-intent'
import { OAUTH_PROVIDER_COOKIE, isOAuthProvider, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { internalPath } from '@/lib/auth/internal-path'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { AUTH_RETURN_COOKIE, readAuthReturnCookie } from '@/lib/auth/auth-return'
import { routes } from '@/lib/routes'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { SIGNUP_INTENT_COOKIE, sharedCookieDomain } from '@moldwright/analytics'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function publicUrl(request: Request, destination: string): string {
    const { origin } = new URL(request.url)
    const forwardedHost = request.headers.get('x-forwarded-host')
    if (process.env.NODE_ENV === 'development' || !forwardedHost) return `${origin}${destination}`
    return `https://${forwardedHost}${destination}`
}

const SIGNUP_STAMP_WINDOW_MS = 2 * 60 * 1000

async function wasSignedUpBeforeThisSignIn(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
    const { data } = await selectMaybeSingle(supabase, 'users', ['signed_up_at'] as const, { id: userId })
    if (!data?.signed_up_at) return false
    return Date.now() - Date.parse(data.signed_up_at) > SIGNUP_STAMP_WINDOW_MS
}

function forgetSignupIntent(request: Request, response: NextResponse) {
    const domain = sharedCookieDomain(new URL(publicUrl(request, '/')).hostname)
    response.cookies.set(SIGNUP_INTENT_COOKIE, '', { path: '/', maxAge: 0, ...(domain && { domain }) })
}

function providerIn(value: string | undefined): OAuthProvider {
    return isOAuthProvider(value) ? value : 'google'
}

function backToAccount(request: Request, linkError?: { code: string; provider: OAuthProvider }): NextResponse {
    const params = new URLSearchParams({
        [ACCOUNT_PARAM]: 'sign-in',
        ...(linkError ? { [ACCOUNT_LINK_ERROR_PARAM]: linkError.code, [ACCOUNT_LINK_PROVIDER_PARAM]: linkError.provider } : {}),
    })
    const response = NextResponse.redirect(publicUrl(request, `${routes.board}?${params}`))
    response.cookies.delete(LINK_INTENT_COOKIE)
    return response
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const cookieStore = await cookies()
    const linking = cookieStore.has(LINK_INTENT_COOKIE)

    const sessionCookies: { name: string; value: string; options: CookieOptions }[] = []

    const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        cookies: {
            getAll() {
                return cookieStore.getAll()
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) => sessionCookies.push({ name, value, options }))
            },
        },
    })

    const withSessionCookies = (response: NextResponse) => {
        sessionCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        return response
    }

    if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error && data.session) {
            const pendingInvite = linking ? undefined : cookieStore.get(PENDING_INVITE_COOKIE)?.value
            const authReturn = linking ? undefined : readAuthReturnCookie(cookieStore.get(AUTH_RETURN_COOKIE)?.value)
            const response = withSessionCookies(linking ? backToAccount(request) : NextResponse.redirect(publicUrl(request, internalPath(pendingInvite ?? authReturn, routes.board))))

            if (pendingInvite) {
                response.cookies.delete(PENDING_INVITE_COOKIE)
            }
            if (authReturn) response.cookies.delete(AUTH_RETURN_COOKIE)

            const provider = cookieStore.get(OAUTH_PROVIDER_COOKIE)?.value
            if (!linking && isOAuthProvider(provider)) response.cookies.set(LAST_SIGN_IN_COOKIE, provider, { path: '/', maxAge: LAST_SIGN_IN_MAX_AGE_SECONDS, sameSite: 'lax' })

            if (!linking && (await wasSignedUpBeforeThisSignIn(supabase, data.session.user.id))) forgetSignupIntent(request, response)

            return response
        }
    }

    const errorCode = searchParams.get('error_code')

    if (linking) return backToAccount(request, { code: errorCode ?? 'failed', provider: providerIn(cookieStore.get(LINK_INTENT_COOKIE)?.value) })

    if (errorCode === 'identity_already_exists') {
        const provider = providerIn(cookieStore.get(OAUTH_PROVIDER_COOKIE)?.value)
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo: publicUrl(request, routes.authCallback), ...(provider === 'google' && { queryParams: { access_type: 'offline' } }) },
        })
        if (!error && data.url) return withSessionCookies(NextResponse.redirect(data.url))
    }

    return NextResponse.redirect(publicUrl(request, routes.authCodeError))
}
