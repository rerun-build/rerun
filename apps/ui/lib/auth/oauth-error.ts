const OAUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description'] as const

function fragmentParams(url: URL): URLSearchParams {
    return new URLSearchParams(url.hash.replace(/^#/, ''))
}

function carriesOAuthError(params: URLSearchParams): boolean {
    return params.has('error_code') || params.has('error_description')
}

export function oauthErrorCode(url: URL): string | null {
    for (const params of [url.searchParams, fragmentParams(url)]) {
        if (carriesOAuthError(params)) return params.get('error_code') ?? params.get('error') ?? 'unknown'
    }
    return null
}

export function withoutOAuthError(url: URL): URL {
    const clean = new URL(url)
    if (carriesOAuthError(clean.searchParams)) for (const key of OAUTH_ERROR_PARAMS) clean.searchParams.delete(key)
    if (carriesOAuthError(fragmentParams(clean))) clean.hash = ''
    return clean
}

export type OAuthRetryCopy = { title: string; subtitle: string }

export type OAuthRetryTranslator = (key: 'expiredTitle' | 'expiredWithProvider' | 'expired' | 'cancelledTitle' | 'cancelled' | 'failedTitle' | 'failed', values?: { provider: string }) => string

export function oauthRetryCopy(code: string, providerLabel: string | null, t: OAuthRetryTranslator): OAuthRetryCopy {
    if (code === 'bad_oauth_state') {
        return { title: t('expiredTitle'), subtitle: providerLabel ? t('expiredWithProvider', { provider: providerLabel }) : t('expired') }
    }
    if (code === 'access_denied') return { title: t('cancelledTitle'), subtitle: t('cancelled') }
    return { title: t('failedTitle'), subtitle: t('failed') }
}
