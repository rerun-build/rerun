import { OAUTH_PROVIDER_CONFIG, OAUTH_PROVIDER_COOKIE, OAUTH_PROVIDER_COOKIE_MAX_AGE_SECONDS, isOAuthProvider, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { createClient } from '@/supabase/client'
import { SIGNUP_INTENT_COOKIE } from '@rerun/analytics'
import { getCookie, setSharedCookie } from '@rerun/analytics/client'

export async function startOAuthSignIn(provider: OAuthProvider, { linkAnonymous = false }: { linkAnonymous?: boolean } = {}) {
    setSharedCookie(SIGNUP_INTENT_COOKIE, provider, 1)
    document.cookie = `${OAUTH_PROVIDER_COOKIE}=${provider}; path=/; max-age=${OAUTH_PROVIDER_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
    const supabase = createClient()
    const options = { redirectTo: `${window.location.origin}/auth/callback`, queryParams: OAUTH_PROVIDER_CONFIG[provider].queryParams }
    if (linkAnonymous) {
        const { error } = await supabase.auth.linkIdentity({ provider, options })
        if (!error) return
    }
    await supabase.auth.signInWithOAuth({ provider, options })
}

export function oauthProviderLeftFor(): OAuthProvider | null {
    const value = getCookie(OAUTH_PROVIDER_COOKIE)
    return isOAuthProvider(value) ? value : null
}
