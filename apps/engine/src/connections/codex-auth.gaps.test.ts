import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-gaps-'))

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { ensureCodexAuth, jwtExpiresAt } = await import('./codex-auth.js')
const { forgetCredentialRejected, isCredentialRejected, recordCredentialRejected } = await import('./credential-rejections.js')
const { readEnvFile, writeEnvFile } = await import('../lib/env-file.js')
const { connectionConfigSchema } = await import('./types.js')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { codexAuthPath, codexHomeDir, connectionDir, connectionEnvPath } = await import('../config/paths.js')

const CONNECTION_ID = 'codexgaps'

function jwt(claims: Record<string, unknown>): string {
    return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

type Connection = NonNullable<Parameters<typeof ensureCodexAuth>[0]>

function connection(env: Record<string, string>): Connection {
    return { id: CONNECTION_ID, config: connectionConfigSchema.parse({ name: 'codex', provider: 'codex', createdAt: new Date().toISOString() }), env }
}

const STALE_ENV = {
    CODEX_OAUTH_TOKEN: jwt({ exp: Math.floor(Date.now() / 1000) + 60 }),
    CODEX_OAUTH_REFRESH_TOKEN: 'refresh-old',
    CODEX_OAUTH_ID_TOKEN: 'id-old',
    CODEX_OAUTH_EXPIRES_AT: String(Date.now() + 60_000),
}

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function answer(status: number, body: unknown): void {
    fetchMock.mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

async function authFile(): Promise<{ tokens: Record<string, string | null> }> {
    return JSON.parse(await readFile(codexAuthPath(CONNECTION_ID), 'utf8'))
}

beforeEach(async () => {
    forgetCredentialRejected(CONNECTION_ID)
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await rm(connectionDir(CONNECTION_ID), { recursive: true, force: true })
    await mkdir(connectionDir(CONNECTION_ID), { recursive: true })
    await writeEnvFile(connectionEnvPath(CONNECTION_ID), { ...STALE_ENV })
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('ensureCodexAuth refresh', () => {
    it('refreshes a token about to lapse and hands the CLI the new one', async () => {
        const next = jwt({ exp: 1_900_000_000 })
        answer(200, { access_token: next, refresh_token: 'refresh-new', id_token: 'id-new' })
        const live = connection({ ...STALE_ENV })

        await ensureCodexAuth(live)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://auth.openai.com/oauth/token')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body as string)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-old' })

        expect(live.env).toMatchObject({ CODEX_OAUTH_TOKEN: next, CODEX_OAUTH_REFRESH_TOKEN: 'refresh-new', CODEX_OAUTH_ID_TOKEN: 'id-new', CODEX_OAUTH_EXPIRES_AT: '1900000000000' })
        expect(await readEnvFile(connectionEnvPath(CONNECTION_ID))).toMatchObject({ CODEX_OAUTH_TOKEN: next, CODEX_OAUTH_REFRESH_TOKEN: 'refresh-new', CODEX_OAUTH_EXPIRES_AT: '1900000000000' })
        expect((await authFile()).tokens).toMatchObject({ access_token: next, refresh_token: 'refresh-new', id_token: 'id-new' })
    })

    it('keeps the refresh token and id token it had when the endpoint does not rotate them', async () => {
        answer(200, { access_token: 'opaque-access-token' })
        const live = connection({ ...STALE_ENV })
        const before = Date.now()

        await ensureCodexAuth(live)

        expect(live.env.CODEX_OAUTH_TOKEN).toBe('opaque-access-token')
        expect(live.env.CODEX_OAUTH_REFRESH_TOKEN).toBe('refresh-old')
        expect(live.env.CODEX_OAUTH_ID_TOKEN).toBe('id-old')
        const expiresAt = Number(live.env.CODEX_OAUTH_EXPIRES_AT)
        expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
        expect(expiresAt).toBeLessThan(before + 3_700_000)
    })

    it('treats a connection with no recorded expiry as stale', async () => {
        answer(200, { access_token: 'fresh' })
        const { CODEX_OAUTH_EXPIRES_AT: _, ...noExpiry } = STALE_ENV

        await ensureCodexAuth(connection(noExpiry))

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['a rejected refresh', 401, { error: 'invalid_grant' }],
        ['a success without an access token', 200, {}],
        ['a body that is not JSON', 502, '<html>bad gateway</html>'],
    ])('leaves the credentials alone after %s, and still writes auth.json', async (_label, status, body) => {
        answer(status, body)
        const live = connection({ ...STALE_ENV })

        await ensureCodexAuth(live)

        expect(live.env).toEqual(STALE_ENV)
        expect(await readEnvFile(connectionEnvPath(CONNECTION_ID))).toEqual(STALE_ENV)
        expect((await authFile()).tokens.access_token).toBe(STALE_ENV.CODEX_OAUTH_TOKEN)
    })

    it.each([
        ['a 400', 400, true],
        ['a 401', 401, true],
        ['a 502', 502, false],
    ])('flags the credential as rejected only when the refresh token is dead: %s', async (_label, status, rejected) => {
        answer(status, { error: 'invalid_grant' })
        await ensureCodexAuth(connection({ ...STALE_ENV }))
        expect(isCredentialRejected(CONNECTION_ID)).toBe(rejected)
    })

    it('clears the rejection once a refresh goes through', async () => {
        recordCredentialRejected(CONNECTION_ID)
        answer(200, { access_token: 'opaque' })
        await ensureCodexAuth(connection({ ...STALE_ENV }))
        expect(isCredentialRejected(CONNECTION_ID)).toBe(false)
    })

    it('does not reach the endpoint for a stale token that has no refresh token', async () => {
        const { CODEX_OAUTH_REFRESH_TOKEN: _, ...noRefresh } = STALE_ENV

        await ensureCodexAuth(connection(noRefresh))

        expect(fetchMock).not.toHaveBeenCalled()
        expect((await authFile()).tokens.refresh_token).toBe('')
    })

    it('shares one refresh between concurrent callers of the same connection', async () => {
        answer(200, { access_token: 'shared', refresh_token: 'refresh-new' })
        const live = connection({ ...STALE_ENV })

        await Promise.all([ensureCodexAuth(live), ensureCodexAuth(live), ensureCodexAuth(live)])

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(live.env.CODEX_OAUTH_TOKEN).toBe('shared')
    })

    it('refreshes again on a later call once the first one settled', async () => {
        answer(200, { access_token: 'opaque' })
        const live = connection({ ...STALE_ENV })

        await ensureCodexAuth(live)
        await ensureCodexAuth(connection({ ...STALE_ENV }))

        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('swallows a failure to write auth.json, so the run goes on and reports the CLI error instead', async () => {
        await writeFile(codexHomeDir(CONNECTION_ID), 'not a directory', 'utf8')
        const { CODEX_OAUTH_REFRESH_TOKEN: _, ...noRefresh } = STALE_ENV

        await expect(ensureCodexAuth(connection(noRefresh))).resolves.toBeUndefined()

        await rm(codexHomeDir(CONNECTION_ID), { force: true })
        await ensureCodexAuth(connection(noRefresh))
        expect((await authFile()).tokens.access_token).toBe(STALE_ENV.CODEX_OAUTH_TOKEN)
    })

    it('does nothing for a missing connection', async () => {
        await expect(ensureCodexAuth(null)).resolves.toBeUndefined()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('jwtExpiresAt edge cases', () => {
    it('returns undefined when the payload is not JSON', () => {
        expect(jwtExpiresAt(`header.${Buffer.from('not json').toString('base64url')}.sig`)).toBeUndefined()
    })

    it('returns undefined when exp is not a number', () => {
        expect(jwtExpiresAt(jwt({ exp: '1700000000' }))).toBeUndefined()
        expect(jwtExpiresAt(jwt({ sub: 'user' }))).toBeUndefined()
    })
})
