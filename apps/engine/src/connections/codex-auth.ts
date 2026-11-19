import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { CONNECTION_TOKEN_KEY } from '@moldwright/contracts'
import { codexAuthPath, codexHomeDir, connectionEnvPath } from '../config/paths.js'
import { readEnvFile, writeEnvFile } from '../lib/env-file.js'
import { logger } from '../lib/logger.js'
import { forgetCredentialRejected, recordCredentialRejected } from './credential-rejections.js'
import { withConnectionLock } from './lock.js'
import type { LoadedConnection } from './types.js'

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REFRESH_SKEW_MS = 5 * 60_000

const TOKEN_KEY = CONNECTION_TOKEN_KEY.codex
const REFRESH_KEY = 'CODEX_OAUTH_REFRESH_TOKEN'
const ID_TOKEN_KEY = 'CODEX_OAUTH_ID_TOKEN'
const ACCOUNT_KEY = 'CODEX_OAUTH_ACCOUNT_ID'
const EXPIRES_KEY = 'CODEX_OAUTH_EXPIRES_AT'

type CodexAuthFile = {
    OPENAI_API_KEY: string | null
    tokens: { id_token: string; access_token: string; refresh_token: string; account_id: string | null }
    last_refresh: string
}

const inFlight = new Map<string, Promise<void>>()

async function writeAuthFile(connection: LoadedConnection): Promise<void> {
    const auth: CodexAuthFile = {
        OPENAI_API_KEY: null,
        tokens: {
            id_token: connection.env[ID_TOKEN_KEY] ?? '',
            access_token: connection.env[TOKEN_KEY] ?? '',
            refresh_token: connection.env[REFRESH_KEY] ?? '',
            account_id: connection.env[ACCOUNT_KEY] || null,
        },
        last_refresh: new Date().toISOString(),
    }
    await mkdir(codexHomeDir(connection.id), { recursive: true, mode: 0o700 })
    const target = codexAuthPath(connection.id)
    const tmp = `${target}.tmp`
    await writeFile(tmp, JSON.stringify(auth, null, 2), 'utf8')
    await chmod(tmp, 0o600)
    await rename(tmp, target)
}

async function persistTokens(connection: LoadedConnection, next: Partial<Record<string, string>>): Promise<void> {
    await withConnectionLock(connection.id, async () => {
        const path = connectionEnvPath(connection.id)
        const env = await readEnvFile(path)
        for (const [key, value] of Object.entries(next)) {
            if (value === undefined) continue
            env[key] = value
            connection.env[key] = value
        }
        await writeEnvFile(path, env)
    })
}

async function refresh(connection: LoadedConnection, refreshToken: string): Promise<void> {
    const res = await fetch(CODEX_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', client_id: CODEX_OAUTH_CLIENT_ID, refresh_token: refreshToken }),
    })
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string }
    if (!res.ok || !data.access_token) {
        const dead = res.status === 400 || res.status === 401
        logger[dead ? 'error' : 'warn']({ connection: connection.id, status: res.status, hasAccessToken: !!data.access_token }, 'codex token refresh failed')
        if (dead) recordCredentialRejected(connection.id)
        return
    }

    await persistTokens(connection, {
        [TOKEN_KEY]: data.access_token,
        [REFRESH_KEY]: data.refresh_token ?? refreshToken,
        ...(data.id_token ? { [ID_TOKEN_KEY]: data.id_token } : {}),
        [EXPIRES_KEY]: String(jwtExpiresAt(data.access_token) ?? Date.now() + 3_600_000),
    })

    forgetCredentialRejected(connection.id)
    logger.info({ connection: connection.id, rotatedRefreshToken: !!data.refresh_token }, 'codex token refreshed')
}

export function jwtExpiresAt(jwt: string): number | undefined {
    const payload = jwt.split('.')[1]
    if (!payload) return undefined
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
        return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined
    } catch {
        return undefined
    }
}

export async function ensureCodexAuth(connection: LoadedConnection | null): Promise<void> {
    if (!connection) return
    if (!connection.env[TOKEN_KEY]) {
        logger.debug({ connection: connection.id }, 'codex auth: no token, skipping')
        return
    }

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    const task = (async () => {
        const refreshToken = connection.env[REFRESH_KEY]
        const expiresAt = Number(connection.env[EXPIRES_KEY])
        const stale = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= REFRESH_SKEW_MS
        if (refreshToken && stale) await refresh(connection, refreshToken)
        await writeAuthFile(connection)
    })()
        .catch(err => logger.warn({ connection: connection.id, err: (err as Error).message }, 'codex auth prep failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

export async function syncCodexAuth(connection: LoadedConnection | null): Promise<void> {
    if (!connection) return
    const raw = await readFile(codexAuthPath(connection.id), 'utf8').catch(() => null)
    if (!raw) return
    let tokens: CodexAuthFile['tokens'] | undefined
    try {
        tokens = (JSON.parse(raw) as CodexAuthFile).tokens
    } catch {
        return
    }
    if (!tokens?.access_token || tokens.access_token === connection.env[TOKEN_KEY]) return

    await persistTokens(connection, {
        [TOKEN_KEY]: tokens.access_token,
        ...(tokens.refresh_token ? { [REFRESH_KEY]: tokens.refresh_token } : {}),
        ...(tokens.id_token ? { [ID_TOKEN_KEY]: tokens.id_token } : {}),
        ...(tokens.account_id ? { [ACCOUNT_KEY]: tokens.account_id } : {}),
        [EXPIRES_KEY]: String(jwtExpiresAt(tokens.access_token) ?? Date.now() + 3_600_000),
    })
    logger.info({ connection: connection.id }, 'codex token rotated by the CLI, synced back')
}
