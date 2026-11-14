import type { AiConnectionFailureReason, AiConnectionMethod, AiConnectionSurface } from '@rerun/analytics'
import { track } from '@rerun/analytics/client'

const ERROR_MAX_LENGTH = 200

export function connectionMethod(provider: string, keys: Record<string, string>): AiConnectionMethod {
    if (provider === 'codex') return 'oauth'
    if (provider === 'claude') return keys.CLAUDE_CODE_OAUTH_REFRESH_TOKEN ? 'oauth' : 'token'
    return 'api_key'
}

export function trackAiConnectionConnected(provider: string, keys: Record<string, string>, surface: AiConnectionSurface) {
    track('ai_connection_connected', { provider, method: connectionMethod(provider, keys), surface }, { set: { ai_provider_connected: true }, setOnce: { first_ai_provider: provider } })
}

export function trackAiConnectionFailed(provider: string, method: AiConnectionMethod, surface: AiConnectionSurface, reason: AiConnectionFailureReason, error?: string) {
    track('ai_connection_failed', { provider, method, surface, reason, error: error?.slice(0, ERROR_MAX_LENGTH) })
}
