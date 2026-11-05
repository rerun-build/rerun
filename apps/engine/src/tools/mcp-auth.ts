import { readFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isPathSegment, mcpDir, mcpPendingPath, mcpTokenPath } from '../config/paths.js'
import type { McpServer } from '../agents/types.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { logger } from '../lib/logger.js'

const DEVICE_CLIENT_ID = 'hermes'
const DEVICE_SCOPE = 'openid email offline_access'
const REFRESH_SKEW_MS = 60_000

export type StoredToken = {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scope?: string
    // Present for browser authorization-code tokens (UI-driven OAuth): the token
    // endpoint + client the engine must reuse to refresh, independent of the
    // device-code discovery path below. Absent for device-code tokens.
    tokenEndpoint?: string
    clientId?: string
    clientSecret?: string
    obtainedAt: number
}

export type DeviceAuth = { deviceEndpoint: string; tokenEndpoint: string }

export type DeviceStart = { deviceCode: string; verificationUri: string; interval: number; expiresIn: number }

export type PendingDevice = { auth: DeviceAuth; start: DeviceStart; startedAt: number }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function isAuthError(message?: string): boolean {
    return /\b401\b|unauthor/i.test(message ?? '')
}

export async function discoverDeviceAuth(mcpUrl: string): Promise<DeviceAuth> {
    const origin = new URL(mcpUrl).origin
    const res = await fetch(`${origin}/.well-known/oauth-protected-resource`)
    if (!res.ok) throw new Error(`no OAuth metadata at ${origin} (${res.status})`)
    const meta = (await res.json()) as {
        authorization_servers?: string[]
        higgsfield_auth_hints?: { options?: Array<{ flow?: string; authorization_server?: string }> }
    }
    const hinted = meta.higgsfield_auth_hints?.options?.find(o => o.flow === 'device_code')?.authorization_server
    const base = hinted ?? meta.authorization_servers?.find(s => s.includes('device'))
    if (!base) throw new Error('this MCP server does not advertise a device-code OAuth flow')
    return { deviceEndpoint: `${trimSlash(base)}/authorize`, tokenEndpoint: `${trimSlash(base)}/token` }
}

export async function startDeviceFlow(auth: DeviceAuth): Promise<DeviceStart> {
    const res = await fetch(auth.deviceEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: DEVICE_CLIENT_ID, scope: DEVICE_SCOPE }).toString(),
    })
    if (!res.ok) throw new Error(`device authorization request failed (${res.status})`)
    const data = (await res.json()) as { device_code: string; verification_uri: string; interval?: number; expires_in?: number }
    return { deviceCode: data.device_code, verificationUri: data.verification_uri, interval: data.interval ?? 5, expiresIn: data.expires_in ?? 900 }
}

function tokenFromResponse(data: Record<string, unknown>): StoredToken {
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined
    return {
        accessToken: String(data.access_token),
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        scope: typeof data.scope === 'string' ? data.scope : undefined,
        obtainedAt: Date.now(),
    }
}

export async function pollDeviceToken(auth: DeviceAuth, start: DeviceStart, opts: { maxWaitMs?: number; onPending?: () => void } = {}): Promise<StoredToken> {
    const hardDeadline = Date.now() + start.expiresIn * 1000
    const deadline = opts.maxWaitMs ? Math.min(hardDeadline, Date.now() + opts.maxWaitMs) : hardDeadline
    let interval = start.interval
    let sawPending = false
    while (Date.now() < deadline) {
        await sleep(interval * 1000)
        const res = await fetch(auth.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: start.deviceCode }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (data.access_token) return tokenFromResponse(data)
        const detail = String(data.detail ?? data.error ?? res.status)
        if (detail === 'authorization_pending') {
            sawPending = true
            opts.onPending?.()
            continue
        }
        if (detail === 'slow_down') {
            interval += 5
            continue
        }
        if (detail === 'expired_token') throw new Error('the sign-in link expired before it was used')
        throw new Error(`authorization failed: ${detail}`)
    }
    if (sawPending) throw new Error('still waiting for sign-in — finish opening the link, then try again')
    throw new Error('the sign-in link expired before it was used')
}

function logRefreshRefused(res: Response, data: Record<string, unknown>): void {
    logger.warn({ status: res.status, error: data.error, description: data.error_description }, 'mcp token refresh refused')
}

// Refresh an authorization-code token straight against its stored token endpoint
// (RFC 6749 form-encoded grant). Used for UI-driven OAuth, where the client id and
// endpoint are known up front and no device-code discovery is needed.
async function refreshWithEndpoint(token: StoredToken): Promise<StoredToken | null> {
    if (!token.refreshToken || !token.tokenEndpoint) return null
    try {
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refreshToken })
        if (token.clientId) body.set('client_id', token.clientId)
        if (token.clientSecret) body.set('client_secret', token.clientSecret)
        const res = await fetch(token.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (data.access_token) {
            const next = tokenFromResponse(data)
            if (!next.refreshToken) next.refreshToken = token.refreshToken
            next.tokenEndpoint = token.tokenEndpoint
            next.clientId = token.clientId
            next.clientSecret = token.clientSecret
            return next
        }
        logRefreshRefused(res, data)
    } catch (e) {
        logger.warn({ err: (e as Error).message }, 'mcp token refresh failed')
    }
    return null
}

async function refreshToken(auth: DeviceAuth, token: StoredToken): Promise<StoredToken | null> {
    if (!token.refreshToken) return null
    try {
        const res = await fetch(auth.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'refresh_token', client_id: DEVICE_CLIENT_ID, refresh_token: token.refreshToken }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (data.access_token) {
            const next = tokenFromResponse(data)
            if (!next.refreshToken) next.refreshToken = token.refreshToken
            return next
        }
        logRefreshRefused(res, data)
    } catch (e) {
        logger.warn({ err: (e as Error).message }, 'mcp token refresh failed')
    }
    return null
}

// Tokens are the agent's credentials: the folder and its files are readable by the engine's uid only.
export async function saveToken(agentId: string, name: string, token: StoredToken): Promise<void> {
    await mkdir(mcpDir(agentId), { recursive: true, mode: 0o700 })
    await writeFileAtomic(mcpTokenPath(agentId, name), JSON.stringify(token, null, 4), { mode: 0o600 })
}

// A legacy server name that could never have been saved under has nothing stored: the read paths
// answer that instead of throwing, so the agent carrying it keeps running and the name stays removable.
export async function loadToken(agentId: string, name: string): Promise<StoredToken | null> {
    if (!isPathSegment(name)) return null
    const path = mcpTokenPath(agentId, name)
    if (!existsSync(path)) return null
    try {
        return JSON.parse(await readFile(path, 'utf8')) as StoredToken
    } catch {
        return null
    }
}

export async function clearToken(agentId: string, name: string): Promise<void> {
    if (!isPathSegment(name)) return
    const path = mcpTokenPath(agentId, name)
    if (existsSync(path)) await rm(path)
}

export async function savePending(agentId: string, name: string, pending: PendingDevice): Promise<void> {
    await mkdir(mcpDir(agentId), { recursive: true, mode: 0o700 })
    await writeFileAtomic(mcpPendingPath(agentId, name), JSON.stringify(pending, null, 4), { mode: 0o600 })
}

export async function loadPending(agentId: string, name: string): Promise<PendingDevice | null> {
    if (!isPathSegment(name)) return null
    const path = mcpPendingPath(agentId, name)
    if (!existsSync(path)) return null
    try {
        return JSON.parse(await readFile(path, 'utf8')) as PendingDevice
    } catch {
        return null
    }
}

export async function clearPending(agentId: string, name: string): Promise<void> {
    if (!isPathSegment(name)) return
    const path = mcpPendingPath(agentId, name)
    if (existsSync(path)) await rm(path)
}

// Keyed per agent and server, and held across the read of the token file too: two runs starting
// together would otherwise both refresh with the same refresh token, and a provider that rotates
// them (Affonso) answers the reuse by revoking the whole grant.
const inFlight = new Map<string, Promise<string | null>>()

function ensureAccessToken(agentId: string, server: McpServer): Promise<string | null> {
    const key = `${agentId}/${server.name}`
    const pending = inFlight.get(key)
    if (pending) return pending
    const task = loadFreshAccessToken(agentId, server).finally(() => inFlight.delete(key))
    inFlight.set(key, task)
    return task
}

async function loadFreshAccessToken(agentId: string, server: McpServer): Promise<string | null> {
    const stored = await loadToken(agentId, server.name)
    if (!stored) return null
    const expired = stored.expiresAt !== undefined && stored.expiresAt - Date.now() < REFRESH_SKEW_MS
    if (!expired) return stored.accessToken
    try {
        const refreshed = stored.tokenEndpoint
            ? await refreshWithEndpoint(stored)
            : server.url
              ? await refreshToken(await discoverDeviceAuth(server.url), stored)
              : null
        if (refreshed) {
            await saveToken(agentId, server.name, refreshed)
            return refreshed.accessToken
        }
    } catch (e) {
        logger.warn({ server: server.name, err: (e as Error).message }, 'mcp token refresh skipped')
    }
    return stored.accessToken
}

export async function withAuth(agentId: string, server: McpServer): Promise<McpServer> {
    if (!server.url) return server
    const token = await ensureAccessToken(agentId, server)
    if (!token) return server
    return { ...server, headers: { Authorization: `Bearer ${token}`, ...server.headers } }
}

export async function deviceLogin(agentId: string, server: McpServer, onPrompt: (start: DeviceStart) => void): Promise<StoredToken> {
    if (!server.url) throw new Error(`server "${server.name}" is stdio-based and does not use OAuth`)
    const auth = await discoverDeviceAuth(server.url)
    const start = await startDeviceFlow(auth)
    onPrompt(start)
    const token = await pollDeviceToken(auth, start, { onPending: () => {} })
    await saveToken(agentId, server.name, token)
    return token
}
