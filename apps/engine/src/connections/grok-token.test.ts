import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-grok-token-'))
process.env.RERUN_API_KEY = ''

const logged = vi.hoisted(() => [] as unknown[][])
const failWrites = vi.hoisted(() => ({ next: 0 }))

vi.mock('../lib/logger.js', () => {
    const record = (level: string) => (...args: unknown[]) => {
        logged.push([level, ...args])
    }
    return { logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') } }
})

vi.mock('../lib/env-file.js', async importOriginal => {
    const original = await importOriginal<typeof import('../lib/env-file.js')>()
    return {
        ...original,
        writeEnvFile: async (path: string, env: Record<string, string>) => {
            if (failWrites.next > 0) {
                failWrites.next -= 1
                throw new Error('ENOSPC: no space left on device')
            }
            return original.writeEnvFile(path, env)
        },
    }
})

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const { connectionConfigPath, connectionDir, connectionEnvPath } = await import('../config/paths.js')
const { readEnvFile, writeEnvFile } = await import('../lib/env-file.js')
const { GrokAuthError, ensureGrokToken, grokAccessToken, revokeGrokTokens } = await import('./grok-token.js')
const { forgetCredentialRejected, isCredentialRejected } = await import('./credential-rejections.js')
const { deleteConnection, updateConnectionKeys } = await import('./store.js')
const { unloadConnection } = await import('./registry.js')

const NOW = new Date('2026-11-26T12:00:00.000Z').getTime()
const realFetch = globalThis.fetch
const HOUR = 3_600_000

type Call = { url: string; body: URLSearchParams }

/**
 * xAI's authorization server as the prototype found it: every refresh rotates the refresh token,
 * and this one is strict about it, as a server may be once its grace ends: a refresh token used
 * twice revokes its whole lineage, the successor included.
 */
class FakeXaiAuth {
    calls: Call[] = []
    issued = 0
    live = new Set<string>()
    used = new Set<string>()
    revoked = new Set<string>()
    script: (() => Response | Promise<Response> | 'network') [] = []
    rotate = true
    sendIdToken = false

    constructor(refreshToken: string) {
        this.live.add(refreshToken)
    }

    fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        const body = new URLSearchParams(String(init?.body ?? ''))
        this.calls.push({ url, body })
        const scripted = this.script.shift()
        if (scripted) {
            const outcome = await scripted()
            if (outcome === 'network') throw new TypeError('fetch failed')
            return outcome
        }
        if (url.endsWith('/oauth2/revoke')) {
            this.revoked.add(body.get('token') ?? '')
            return new Response(null, { status: 200 })
        }
        const presented = body.get('refresh_token') ?? ''
        if (body.get('client_id') !== 'b1a00492-073a-47ea-816f-4c329264a828' || body.get('grant_type') !== 'refresh_token') return Response.json({ error: 'invalid_request' }, { status: 400 })
        if (this.used.has(presented)) {
            this.live.clear()
            return Response.json({ error: 'invalid_grant', error_description: 'refresh token reused' }, { status: 400 })
        }
        if (!this.live.has(presented)) return Response.json({ error: 'invalid_grant' }, { status: 400 })
        this.issued += 1
        const answer: Record<string, unknown> = { access_token: `access-${this.issued}`, token_type: 'Bearer', expires_in: 21600, scope: 'openid' }
        if (this.rotate) {
            this.used.add(presented)
            this.live.delete(presented)
            const next = `refresh-${this.issued}`
            this.live.add(next)
            answer.refresh_token = next
        }
        if (this.sendIdToken) answer.id_token = `id-${this.issued}`
        return Response.json(answer)
    }

    get refreshes(): number {
        return this.calls.filter(call => call.url.endsWith('/oauth2/token')).length
    }
}

let auth: FakeXaiAuth

const SECRET_PATTERN = /(?:access|refresh|id)-(?:\d+|old|start)/

async function grokConnection(env: Record<string, string>, id = 'grokcnx') {
    unloadConnection(id)
    await rm(connectionDir(id), { recursive: true, force: true })
    await mkdir(connectionDir(id), { recursive: true })
    await writeFile(connectionConfigPath(id), JSON.stringify({ name: 'Grok', provider: 'grok', models: ['grok-4.6'], createdAt: '2026-11-26' }))
    await writeEnvFile(connectionEnvPath(id), { ...env, UNRELATED: 'kept' })
    return { id, config: { name: 'Grok', provider: 'grok' as const, models: ['grok-4.6'], extraModels: [], createdAt: '' }, env: { ...env } }
}

function signedIn(minutesLeft: number) {
    return {
        GROK_OAUTH_TOKEN: 'access-old',
        GROK_OAUTH_REFRESH_TOKEN: 'refresh-start',
        GROK_OAUTH_ID_TOKEN: 'id-start',
        GROK_OAUTH_ACCOUNT_ID: 'account-1',
        GROK_OAUTH_EXPIRES_AT: String(NOW + minutesLeft * 60_000),
    }
}

beforeEach(() => {
    logged.length = 0
    failWrites.next = 0
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout'] })
    auth = new FakeXaiAuth('refresh-start')
    globalThis.fetch = auth.fetch as typeof fetch
    forgetCredentialRejected('grokcnx')
})

afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
    for (const entry of logged) expect(JSON.stringify(entry)).not.toMatch(SECRET_PATTERN)
})

describe('a token with time ahead of it', () => {
    it('is sent as it is, without a call to xAI', async () => {
        const connection = await grokConnection(signedIn(60))
        await ensureGrokToken(connection)
        expect(auth.calls).toHaveLength(0)
        expect(grokAccessToken(connection)).toBe('access-old')
    })
})

describe('a refresh', () => {
    it('rotates the tokens, writes them to disk before handing them out, and keeps the rest of .env', async () => {
        const connection = await grokConnection(signedIn(1))
        await ensureGrokToken(connection)

        expect(auth.refreshes).toBe(1)
        expect(auth.calls[0]!.body.get('client_id')).toBe('b1a00492-073a-47ea-816f-4c329264a828')
        const disk = await readEnvFile(connectionEnvPath('grokcnx'))
        expect(disk).toMatchObject({ GROK_OAUTH_TOKEN: 'access-1', GROK_OAUTH_REFRESH_TOKEN: 'refresh-1', GROK_OAUTH_ID_TOKEN: 'id-start', GROK_OAUTH_ACCOUNT_ID: 'account-1', UNRELATED: 'kept' })
        expect(Number(disk.GROK_OAUTH_EXPIRES_AT)).toBe(NOW + 21_600_000)
        expect(connection.env).toMatchObject({ GROK_OAUTH_TOKEN: 'access-1', GROK_OAUTH_REFRESH_TOKEN: 'refresh-1' })
    })

    it('keeps the refresh token xAI did not replace, and takes a new id token when one comes', async () => {
        auth.rotate = false
        auth.sendIdToken = true
        const connection = await grokConnection(signedIn(1))
        await ensureGrokToken(connection)
        expect(await readEnvFile(connectionEnvPath('grokcnx'))).toMatchObject({ GROK_OAUTH_TOKEN: 'access-1', GROK_OAUTH_REFRESH_TOKEN: 'refresh-start', GROK_OAUTH_ID_TOKEN: 'id-1' })
    })

    it('is shared by ten calls at once: one rotation, never two of the same lineage', async () => {
        const connection = await grokConnection(signedIn(0))
        await Promise.all(Array.from({ length: 10 }, () => ensureGrokToken(connection)))
        expect(auth.refreshes).toBe(1)
        expect(grokAccessToken(connection)).toBe('access-1')
        expect(auth.live.has('refresh-1')).toBe(true)
    })

    it('reads the lineage on disk, not a stale copy in memory: two copies of one connection never refresh it twice', async () => {
        const first = await grokConnection(signedIn(0))
        const second = { ...first, env: { ...first.env } }
        await ensureGrokToken(first)
        await ensureGrokToken(second)
        expect(auth.refreshes).toBe(1)
        expect(grokAccessToken(second)).toBe('access-1')
        expect(auth.live.has('refresh-1')).toBe(true)
    })

    it('starts again from disk after a restart with a token that ran out', async () => {
        await grokConnection(signedIn(-120))
        const restarted = { id: 'grokcnx', config: { name: 'Grok', provider: 'grok' as const, models: [], extraModels: [], createdAt: '' }, env: await readEnvFile(connectionEnvPath('grokcnx')) }
        await ensureGrokToken(restarted)
        expect(grokAccessToken(restarted)).toBe('access-1')
    })
})

describe('a request refused with the token (401)', () => {
    it('forces a refresh even with time left on the token', async () => {
        const connection = await grokConnection(signedIn(60))
        await ensureGrokToken(connection, { rejectedToken: 'access-old' })
        expect(auth.refreshes).toBe(1)
        expect(grokAccessToken(connection)).toBe('access-1')
    })

    it('takes the token another call already renewed, without a second rotation', async () => {
        const connection = await grokConnection(signedIn(60))
        await Promise.all([ensureGrokToken(connection, { rejectedToken: 'access-old' }), ensureGrokToken(connection, { rejectedToken: 'access-old' })])
        expect(auth.refreshes).toBe(1)
        await ensureGrokToken(connection, { rejectedToken: 'access-old' })
        expect(auth.refreshes).toBe(1)
    })
})

describe('a sign-in xAI no longer honours', () => {
    it('reads as signed out and marks the connection for a new sign-in', async () => {
        auth.live.clear()
        const connection = await grokConnection(signedIn(0))
        const failure = ensureGrokToken(connection)
        await expect(failure).rejects.toBeInstanceOf(GrokAuthError)
        await expect(failure).rejects.toMatchObject({ kind: 'signedOut', message: expect.stringContaining('401') })
        expect(isCredentialRejected('grokcnx')).toBe(true)
    })

    it.each(['invalid_client', 'unauthorized_client'])('reads %s the same way', async error => {
        auth.script.push(() => Response.json({ error }, { status: 401 }))
        const connection = await grokConnection(signedIn(0))
        await expect(ensureGrokToken(connection)).rejects.toMatchObject({ kind: 'signedOut' })
    })

    it('reads a connection with no refresh token as signed out', async () => {
        const connection = await grokConnection({ GROK_OAUTH_TOKEN: 'access-old' })
        await expect(ensureGrokToken(connection)).rejects.toMatchObject({ kind: 'signedOut' })
    })

    it('clears the mark once a refresh goes through again', async () => {
        auth.live.clear()
        const connection = await grokConnection(signedIn(0))
        await expect(ensureGrokToken(connection)).rejects.toThrow()
        auth.live.add('refresh-start')
        await ensureGrokToken(connection)
        expect(isCredentialRejected('grokcnx')).toBe(false)
    })
})

// The retries wait on timers the test drives, while the reads and writes of .env are real I/O: one
// turn of the event loop at a time, a second of the clock at a time, until the call is over.
const nextTurn = () => new Promise(resolve => setImmediate(resolve))

async function settle<T>(promise: Promise<T>): Promise<T> {
    let done = false
    promise.then(
        () => (done = true),
        () => (done = true),
    )
    while (!done) {
        await nextTurn()
        await vi.advanceTimersByTimeAsync(1_000)
    }
    return promise
}

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) await nextTurn()
}

describe('xAI out of reach', () => {
    it('tries again after a 5xx, a 429 and a dropped connection', async () => {
        auth.script.push(() => new Response('', { status: 503 }), () => new Response('', { status: 429 }))
        const connection = await grokConnection(signedIn(0))
        await settle(ensureGrokToken(connection))
        expect(auth.refreshes).toBe(3)
        expect(grokAccessToken(connection)).toBe('access-1')

        auth.script.push(() => 'network')
        await settle(ensureGrokToken(connection, { rejectedToken: 'access-1' }))
        expect(grokAccessToken(connection)).toBe('access-2')
    })

    it('keeps serving the token in hand while it lasts, never signs out, and waits before trying again', async () => {
        auth.script.push(() => 'network', () => 'network', () => 'network')
        const connection = await grokConnection(signedIn(1.9))
        await settle(ensureGrokToken(connection))
        const failedAt = Date.now()
        expect(grokAccessToken(connection)).toBe('access-old')
        expect(isCredentialRejected('grokcnx')).toBe(false)

        await ensureGrokToken(connection)
        expect(auth.refreshes).toBe(3)
        vi.setSystemTime(failedAt + 31_000)
        await ensureGrokToken(connection)
        expect(auth.refreshes).toBe(4)
        expect(grokAccessToken(connection)).toBe('access-1')
    })

    it('says the service is unavailable once the token in hand has run out', async () => {
        auth.script.push(() => 'network', () => 'network', () => 'network')
        const connection = await grokConnection(signedIn(-1))
        await expect(settle(ensureGrokToken(connection))).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('unavailable') })
        expect(isCredentialRejected('grokcnx')).toBe(false)
    })

    it('gives up on a request that hangs', async () => {
        auth.script.push(
            () => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException('timed out', 'TimeoutError')), 10_000)),
            () => 'network',
            () => 'network',
        )
        const connection = await grokConnection(signedIn(-1))
        await expect(settle(ensureGrokToken(connection))).rejects.toMatchObject({ kind: 'unavailable' })
    })
})

describe('a write that fails', () => {
    it('hands out nothing it could not keep: the connection stays on the tokens on disk', async () => {
        const connection = await grokConnection(signedIn(0))
        failWrites.next = 1
        await expect(ensureGrokToken(connection)).rejects.toThrow('ENOSPC')
        expect(grokAccessToken(connection)).toBe('access-old')
        expect((await readEnvFile(connectionEnvPath('grokcnx'))).GROK_OAUTH_REFRESH_TOKEN).toBe('refresh-start')
    })
})

describe('a reconnect during a refresh', () => {
    it('lands after it, never between the read and the write: the new sign-in is what stays', async () => {
        let answer!: () => void
        auth.script.push(async () => {
            await new Promise<void>(resolve => (answer = resolve))
            return Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 21600 })
        })
        const connection = await grokConnection(signedIn(0))
        const refreshing = ensureGrokToken(connection)
        await until(() => auth.calls.length === 1)
        const reconnecting = updateConnectionKeys('grokcnx', { set: { GROK_OAUTH_TOKEN: 'access-new-sign-in', GROK_OAUTH_REFRESH_TOKEN: 'refresh-new-sign-in', GROK_OAUTH_EXPIRES_AT: String(NOW + 6 * HOUR) }, remove: [] })
        answer()
        await refreshing
        await reconnecting
        expect(await readEnvFile(connectionEnvPath('grokcnx'))).toMatchObject({ GROK_OAUTH_TOKEN: 'access-new-sign-in', GROK_OAUTH_REFRESH_TOKEN: 'refresh-new-sign-in' })
    })
})

describe('deleting a connection', () => {
    it('hands the sign-in back to xAI, refresh token first, then removes it', async () => {
        await grokConnection(signedIn(60))
        await deleteConnection('grokcnx')
        const revocations = auth.calls.filter(call => call.url === 'https://auth.x.ai/oauth2/revoke')
        expect(revocations.map(call => [call.body.get('token'), call.body.get('token_type_hint'), call.body.get('client_id')])).toEqual([
            ['refresh-start', 'refresh_token', 'b1a00492-073a-47ea-816f-4c329264a828'],
            ['access-old', 'access_token', 'b1a00492-073a-47ea-816f-4c329264a828'],
        ])
        expect(existsSync(connectionDir('grokcnx'))).toBe(false)
    })

    it('goes through when xAI cannot be reached', async () => {
        auth.script.push(() => 'network', () => new Response('', { status: 500 }))
        await grokConnection(signedIn(60))
        await deleteConnection('grokcnx')
        expect(existsSync(connectionDir('grokcnx'))).toBe(false)
    })

    it('hands back nothing for another provider', async () => {
        await grokConnection(signedIn(60))
        await writeFile(connectionConfigPath('grokcnx'), JSON.stringify({ name: 'Claude', provider: 'claude', models: [], createdAt: '2026-11-26' }))
        await deleteConnection('grokcnx')
        expect(auth.calls).toHaveLength(0)
    })

    it('skips what is not there', async () => {
        await revokeGrokTokens({ GROK_OAUTH_TOKEN: 'access-old' })
        expect(auth.calls.map(call => call.body.get('token_type_hint'))).toEqual(['access_token'])
    })
})
