import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-'))

const { beforeEach, describe, expect, it } = await import('vitest')
const { ensureCodexAuth, syncCodexAuth, jwtExpiresAt } = await import('./codex-auth.js')
const { readEnvFile } = await import('../lib/env-file.js')
const { connectionConfigSchema } = await import('./types.js')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { codexAuthPath, codexHomeDir, connectionDir, connectionEnvPath } = await import('../config/paths.js')

const CONNECTION_ID = 'codexconnection'

function jwt(claims: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `header.${body}.signature`
}

const FRESH_TOKEN = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

type Connection = NonNullable<Parameters<typeof ensureCodexAuth>[0]>

function connection(env: Record<string, string>): Connection {
    const withExpiry = env.CODEX_OAUTH_TOKEN ? { CODEX_OAUTH_EXPIRES_AT: String(Date.now() + 3_600_000), ...env } : env
    return { id: CONNECTION_ID, config: connectionConfigSchema.parse({ name: 'codex', provider: 'codex', createdAt: new Date().toISOString() }), env: withExpiry }
}

let fetchCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = (...args: Parameters<typeof realFetch>) => {
    fetchCalls += 1
    return realFetch(...args)
}

beforeEach(async () => {
    fetchCalls = 0
    await rm(codexHomeDir(CONNECTION_ID), { recursive: true, force: true })
    await mkdir(connectionDir(CONNECTION_ID), { recursive: true })
    await writeFile(connectionEnvPath(CONNECTION_ID), '', 'utf8')
})

describe('jwtExpiresAt', () => {
    it('reads the exp claim as epoch milliseconds', () => {
        expect(jwtExpiresAt(jwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000)
    })

    it('returns undefined for a token it cannot parse', () => {
        expect(jwtExpiresAt('not-a-jwt')).toBeUndefined()
        expect(jwtExpiresAt('')).toBeUndefined()
    })
})

describe('ensureCodexAuth', () => {
    it('materialises auth.json in the shape the Codex CLI reads', async () => {
        await ensureCodexAuth(
            connection({
                CODEX_OAUTH_TOKEN: FRESH_TOKEN,
                CODEX_OAUTH_REFRESH_TOKEN: 'refresh-1',
                CODEX_OAUTH_ID_TOKEN: 'id-1',
                CODEX_OAUTH_ACCOUNT_ID: 'acct-1',
                CODEX_OAUTH_EXPIRES_AT: String(Date.now() + 3_600_000),
            }),
        )

        const auth = JSON.parse(await readFile(codexAuthPath(CONNECTION_ID), 'utf8'))
        expect(auth.OPENAI_API_KEY).toBeNull()
        expect(auth.tokens).toEqual({ id_token: 'id-1', access_token: FRESH_TOKEN, refresh_token: 'refresh-1', account_id: 'acct-1' })
        expect(typeof auth.last_refresh).toBe('string')
    })

    it('writes nothing when the connection has no codex token', async () => {
        await ensureCodexAuth(connection({}))
        await expect(readFile(codexAuthPath(CONNECTION_ID), 'utf8')).rejects.toThrow()
    })
})

describe('syncCodexAuth', () => {
    it('persists the token pair back when the CLI rotated it mid-run', async () => {
        const rotated = jwt({ exp: Math.floor(Date.now() / 1000) + 7200 })
        const live = connection({ CODEX_OAUTH_TOKEN: FRESH_TOKEN, CODEX_OAUTH_REFRESH_TOKEN: 'refresh-1' })
        await ensureCodexAuth(live)

        await writeFile(
            codexAuthPath(CONNECTION_ID),
            JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'id-2', access_token: rotated, refresh_token: 'refresh-2', account_id: 'acct-2' }, last_refresh: new Date().toISOString() }),
            'utf8',
        )
        await syncCodexAuth(live)

        expect(live.env.CODEX_OAUTH_TOKEN).toBe(rotated)
        expect(live.env.CODEX_OAUTH_REFRESH_TOKEN).toBe('refresh-2')
        expect(live.env.CODEX_OAUTH_ACCOUNT_ID).toBe('acct-2')

        const persisted = await readEnvFile(connectionEnvPath(CONNECTION_ID))
        expect(persisted.CODEX_OAUTH_TOKEN).toBe(rotated)
        expect(persisted.CODEX_OAUTH_REFRESH_TOKEN).toBe('refresh-2')
    })

    it('is a no-op when the CLI left the token untouched', async () => {
        const live = connection({ CODEX_OAUTH_TOKEN: FRESH_TOKEN, CODEX_OAUTH_REFRESH_TOKEN: 'refresh-1' })
        await ensureCodexAuth(live)
        await syncCodexAuth(live)

        expect(live.env.CODEX_OAUTH_REFRESH_TOKEN).toBe('refresh-1')
        expect(await readEnvFile(connectionEnvPath(CONNECTION_ID))).toEqual({})
        expect(fetchCalls).toBe(0)
    })

    it('tolerates a missing or unparseable auth.json', async () => {
        const live = connection({ CODEX_OAUTH_TOKEN: FRESH_TOKEN })
        await expect(syncCodexAuth(live)).resolves.toBeUndefined()
        await ensureCodexAuth(live)
        await writeFile(codexAuthPath(CONNECTION_ID), 'not json', 'utf8')
        await expect(syncCodexAuth(live)).resolves.toBeUndefined()
    })
})
