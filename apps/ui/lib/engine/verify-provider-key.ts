import 'server-only'

import { CONNECTION_TOKEN_KEY, OPENCODE_USAGE_URL, type Provider } from '@rerun/contracts'
import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'

const VERIFY_TIMEOUT_MS = 5000

export type KeyProblem = { code: ErrorCode; params?: ErrorParams }

type KeyCheck = { name: string; request: (key: string) => [string, RequestInit]; rejects: (res: Response) => Promise<boolean> }

const deniedAuth = async (res: Response) => res.status === 401 || res.status === 403

async function errorCode(res: Response): Promise<string | null> {
    try {
        const body = (await res.json()) as { error?: { code?: unknown } }
        return typeof body.error?.code === 'string' ? body.error.code : null
    } catch {
        return null
    }
}

// The cheapest authenticated read each provider offers. Only an explicit "this key is not valid"
// answer counts: an outage, a rate limit or a timeout must never stand between a user and a key
// that may well be fine, so anything else lets it through.
const KEY_CHECKS: Partial<Record<Provider, KeyCheck>> = {
    anthropic: {
        name: 'Anthropic',
        request: key => ['https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }],
        rejects: deniedAuth,
    },
    openai: {
        name: 'OpenAI',
        request: key => ['https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }],
        // A restricted key without "Models: Read" gets a 401 here and still runs every completion.
        rejects: async res => (await deniedAuth(res)) && (await errorCode(res)) !== 'missing_scope',
    },
    google: {
        name: 'Google',
        request: key => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }],
        // Google answers a malformed or unknown key with a 400 rather than a 401.
        rejects: async res => (await deniedAuth(res)) || (res.status === 400 && (await res.text()).includes('API_KEY_INVALID')),
    },
    // The only OpenCode endpoint that checks a key. A Console-only key may well be refused the Go
    // plan's usage with a 403, so only a 401 says the key itself is wrong.
    opencode: {
        name: 'OpenCode',
        request: key => [OPENCODE_USAGE_URL, { headers: { Authorization: `Bearer ${key}` } }],
        rejects: async res => res.status === 401,
    },
    openrouter: {
        name: 'OpenRouter',
        request: key => ['https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } }],
        rejects: deniedAuth,
    },
}

// What is wrong with an API key about to be stored, or null when its provider took it (or could
// not be asked). Saved unchecked, a mistyped key reads as "Ready" and fails every run.
export async function providerKeyProblem(provider: Provider, keys: Record<string, string> | undefined, baseUrl?: string): Promise<KeyProblem | null> {
    const check = KEY_CHECKS[provider]
    const key = keys?.[CONNECTION_TOKEN_KEY[provider]]?.trim()
    if (!check || !key) return null
    if (provider === 'anthropic' && key.startsWith('sk-ant-oat')) return { code: 'claudePlanTokenAsApiKey' }
    // A router of the user's own answers for its own keys, not openrouter.ai.
    if (provider === 'openrouter' && baseUrl) return null

    try {
        const [url, init] = check.request(key)
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) })
        if (await check.rejects(res)) return { code: 'providerKeyRejected', params: { provider: check.name } }
    } catch {
        return null
    }
    return null
}
