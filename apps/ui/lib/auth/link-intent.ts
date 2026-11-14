import { OAUTH_PROVIDER_CONFIG, type OAuthProvider } from '@/lib/auth/oauth-providers'

export const LINK_INTENT_COOKIE = 'rr_link_intent'
const LINK_INTENT_MAX_AGE_SECONDS = 600

export const ACCOUNT_PARAM = 'account'
export const ACCOUNT_LINK_ERROR_PARAM = 'link_error'
export const ACCOUNT_LINK_PROVIDER_PARAM = 'link_provider'

export function rememberLinkIntent(provider: OAuthProvider) {
    document.cookie = `${LINK_INTENT_COOKIE}=${provider}; path=/; max-age=${LINK_INTENT_MAX_AGE_SECONDS}; samesite=lax`
}

export function forgetLinkIntent() {
    document.cookie = `${LINK_INTENT_COOKIE}=; path=/; max-age=0; samesite=lax`
}

export type LinkErrorCopy = (key: 'identityTaken' | 'denied' | 'failed', values: { provider: string }) => string

export function linkErrorMessage(code: string, provider: OAuthProvider, t: LinkErrorCopy): string {
    const { label } = OAUTH_PROVIDER_CONFIG[provider]
    if (code === 'identity_already_exists') return t('identityTaken', { provider: label })
    if (code === 'access_denied') return t('denied', { provider: label })
    return t('failed', { provider: label })
}
