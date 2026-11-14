import { RERUN_CLOUD } from '@rerun/cloud/edition'

export const OAUTH_PROVIDERS = ['google', 'apple'] as const

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

type OAuthProviderConfig = {
    label: string
    queryParams?: Record<string, string>
    refusedInAppBrowser: boolean
}

export const OAUTH_PROVIDER_CONFIG: Record<OAuthProvider, OAuthProviderConfig> = {
    google: { label: 'Google', queryParams: { access_type: 'offline', prompt: 'consent' }, refusedInAppBrowser: true },
    apple: { label: 'Apple', refusedInAppBrowser: false },
}

const CONFIGURED_OAUTH_PROVIDERS = process.env.NEXT_PUBLIC_OAUTH_PROVIDERS

export const ENABLED_OAUTH_PROVIDERS: readonly OAuthProvider[] =
    CONFIGURED_OAUTH_PROVIDERS === undefined ? (RERUN_CLOUD ? OAUTH_PROVIDERS : []) : OAUTH_PROVIDERS.filter(provider => CONFIGURED_OAUTH_PROVIDERS.split(',').map(entry => entry.trim()).includes(provider))

export function isOAuthProvider(value: unknown): value is OAuthProvider {
    return typeof value === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

export const OAUTH_PROVIDER_COOKIE = 'rr_oauth_provider'
export const OAUTH_PROVIDER_COOKIE_MAX_AGE_SECONDS = 600
