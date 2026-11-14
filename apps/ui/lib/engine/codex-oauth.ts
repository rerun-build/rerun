export const CODEX_OAUTH = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    deviceCodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
    devicePollUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    verificationUrl: 'https://auth.openai.com/codex/device',
    redirectUri: 'https://auth.openai.com/deviceauth/callback',
} as const

export type CodexDeviceAuthStart = {
    deviceAuthId: string
    userCode: string
    verificationUrl: string
    pollIntervalMs: number
    expiresAt: number
}

export type CodexOAuthTokens = {
    accessToken: string
    refreshToken: string
    idToken: string
    accountId: string | null
    expiresAt: number
}

const DEFAULT_POLL_INTERVAL_S = 5
const DEFAULT_TTL_MS = 15 * 60_000

function jwtExpiresAt(jwt: string): number | undefined {
    const payload = jwt.split('.')[1]
    if (!payload) return undefined
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
        return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined
    } catch {
        return undefined
    }
}

function jwtAccountId(jwt: string): string | null {
    const payload = jwt.split('.')[1]
    if (!payload) return null
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
        const auth = claims['https://api.openai.com/auth'] as { chatgpt_account_id?: unknown } | undefined
        return typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : null
    } catch {
        return null
    }
}

export async function startCodexDeviceAuth(): Promise<CodexDeviceAuthStart> {
    const res = await fetch(CODEX_OAUTH.deviceCodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CODEX_OAUTH.clientId }),
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => '')
        if (res.status === 404) throw new Error('Device login is not enabled for this account')
        throw new Error(`Could not start the connection (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    const json = (await res.json()) as { device_auth_id?: string; user_code?: string; interval?: string | number; expires_at?: string }
    if (!json.device_auth_id || !json.user_code) throw new Error('Malformed device authorization response')

    const intervalS = Number(json.interval)
    const expiresAt = json.expires_at ? Date.parse(json.expires_at) : NaN
    return {
        deviceAuthId: json.device_auth_id,
        userCode: json.user_code,
        verificationUrl: CODEX_OAUTH.verificationUrl,
        pollIntervalMs: (Number.isFinite(intervalS) && intervalS > 0 ? intervalS : DEFAULT_POLL_INTERVAL_S) * 1000,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + DEFAULT_TTL_MS,
    }
}

export async function pollCodexDeviceAuth(deviceAuthId: string, userCode: string): Promise<CodexOAuthTokens | null> {
    const res = await fetch(CODEX_OAUTH.devicePollUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    })

    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
        const code = body.error?.code
        if (code === 'deviceauth_authorization_pending' || res.status === 403 || res.status === 404) return null
        throw new Error(body.error?.message ?? `Device authorization failed (${res.status})`)
    }

    const json = (await res.json()) as { authorization_code?: string; code_verifier?: string }
    if (!json.authorization_code || !json.code_verifier) throw new Error('Malformed device authorization response')
    return exchangeCodexDeviceCode(json.authorization_code, json.code_verifier)
}

async function exchangeCodexDeviceCode(code: string, verifier: string): Promise<CodexOAuthTokens> {
    const res = await fetch(CODEX_OAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: CODEX_OAUTH.redirectUri,
            client_id: CODEX_OAUTH.clientId,
            code_verifier: verifier,
        }),
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Token exchange failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string }
    if (!json.access_token) throw new Error('No access_token in response')
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? '',
        idToken: json.id_token ?? '',
        accountId: json.id_token ? jwtAccountId(json.id_token) : null,
        expiresAt: jwtExpiresAt(json.access_token) ?? Date.now() + 3_600_000,
    }
}

export function codexKeysFrom(tokens: CodexOAuthTokens): Record<string, string> {
    const keys: Record<string, string> = {
        CODEX_OAUTH_TOKEN: tokens.accessToken,
        CODEX_OAUTH_EXPIRES_AT: String(tokens.expiresAt),
    }
    if (tokens.refreshToken) keys.CODEX_OAUTH_REFRESH_TOKEN = tokens.refreshToken
    if (tokens.idToken) keys.CODEX_OAUTH_ID_TOKEN = tokens.idToken
    if (tokens.accountId) keys.CODEX_OAUTH_ACCOUNT_ID = tokens.accountId
    return keys
}
