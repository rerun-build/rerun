import { createHash, randomBytes } from 'node:crypto'

export const CLAUDE_OAUTH = {
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    redirectUri: 'https://platform.claude.com/oauth/code/callback',
    scope: 'org:create_api_key user:profile user:inference',
} as const

function base64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type ClaudeOAuthStart = {
    authorizeUrl: string
    verifier: string
    state: string
}

export function buildClaudeAuthorize(): ClaudeOAuthStart {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(32))
    const params = new URLSearchParams({
        code: 'true',
        client_id: CLAUDE_OAUTH.clientId,
        response_type: 'code',
        redirect_uri: CLAUDE_OAUTH.redirectUri,
        scope: CLAUDE_OAUTH.scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    })
    return { authorizeUrl: `${CLAUDE_OAUTH.authorizeUrl}?${params.toString()}`, verifier, state }
}

export type ClaudeOAuthToken = {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
}

export async function exchangeClaudeCode(rawCode: string, verifier: string, expectedState: string): Promise<ClaudeOAuthToken> {
    const [code, returnedState] = rawCode.trim().split('#')
    if (!code) throw new Error('Empty code')
    if (returnedState && expectedState && returnedState !== expectedState) throw new Error('Oops, this code comes from another Claude tab. Close your Claude tabs, click Open Claude again and paste the new code.')

    const res = await fetch(CLAUDE_OAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            state: returnedState ?? expectedState,
            redirect_uri: CLAUDE_OAUTH.redirectUri,
            client_id: CLAUDE_OAUTH.clientId,
            code_verifier: verifier,
        }),
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Token exchange failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error('No access_token in response')
    return {
        accessToken: json.access_token,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
        expiresAt: typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : undefined,
    }
}
