import { mkdtempSync } from 'node:fs'
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-auth-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { afterEach, describe, expect, it, vi } = await import('vitest')
const auth = await import('./mcp-auth.js')
const { mcpDir, mcpPendingPath, mcpTokenPath } = await import('../config/paths.js')
const { HttpError } = await import('../lib/errors.js')

type Server = Parameters<typeof auth.withAuth>[1]
type Call = { url: string; init?: RequestInit }

const originalFetch = globalThis.fetch
let calls: Call[] = []

function mockFetch(...responses: Array<Response | (() => Response) | Error>) {
    calls = []
    const queue = [...responses]
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        const next = queue.shift()
        if (!next) throw new Error(`unexpected fetch ${String(url)}`)
        if (next instanceof Error) throw next
        return typeof next === 'function' ? next() : next
    }) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function server(overrides: Partial<Server> = {}): Server {
    return { name: 'linear', url: 'https://mcp.example.com/mcp', args: [], env: {}, headers: {}, ...overrides }
}

afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
})

describe('isAuthError', () => {
    it.each([
        ['HTTP 401 from server', true],
        ['Unauthorized', true],
        ['request was unauthorised by upstream', true],
        ['error 4012 in parser', false],
        ['connection refused', false],
        [undefined, false],
    ])('reads %j as %s', (message, expected) => {
        expect(auth.isAuthError(message)).toBe(expected)
    })
})

describe('discoverDeviceAuth', () => {
    it('prefers the device-code hint over the advertised servers', async () => {
        mockFetch(
            json({
                authorization_servers: ['https://device.other.com'],
                higgsfield_auth_hints: { options: [{ flow: 'browser', authorization_server: 'https://browser.x' }, { flow: 'device_code', authorization_server: 'https://hinted.x/oauth/' }] },
            }),
        )
        expect(await auth.discoverDeviceAuth('https://mcp.example.com/deep/path?q=1')).toEqual({ deviceEndpoint: 'https://hinted.x/oauth/authorize', tokenEndpoint: 'https://hinted.x/oauth/token' })
        expect(calls[0].url).toBe('https://mcp.example.com/.well-known/oauth-protected-resource')
    })

    it('picks the advertised server whose url names a device flow and trims its trailing slashes', async () => {
        mockFetch(json({ authorization_servers: ['https://auth.example.com', 'https://auth.example.com/device//'] }))
        expect(await auth.discoverDeviceAuth('https://mcp.example.com/mcp')).toEqual({ deviceEndpoint: 'https://auth.example.com/device/authorize', tokenEndpoint: 'https://auth.example.com/device/token' })
    })

    it('throws on a non-OK metadata response', async () => {
        mockFetch(new Response('nope', { status: 404 }))
        await expect(auth.discoverDeviceAuth('https://mcp.example.com/mcp')).rejects.toThrow('no OAuth metadata at https://mcp.example.com (404)')
    })

    it('throws when no device-code server is advertised', async () => {
        mockFetch(json({ authorization_servers: ['https://auth.example.com'] }))
        await expect(auth.discoverDeviceAuth('https://mcp.example.com/mcp')).rejects.toThrow('does not advertise a device-code OAuth flow')
    })
})

describe('startDeviceFlow', () => {
    const endpoints = { deviceEndpoint: 'https://a.x/authorize', tokenEndpoint: 'https://a.x/token' }

    it('posts the client and scope form and defaults the interval and lifetime', async () => {
        mockFetch(json({ device_code: 'dc', verification_uri: 'https://a.x/verify' }))
        expect(await auth.startDeviceFlow(endpoints)).toEqual({ deviceCode: 'dc', verificationUri: 'https://a.x/verify', interval: 5, expiresIn: 900 })
        expect(calls[0].url).toBe('https://a.x/authorize')
        expect(calls[0].init?.method).toBe('POST')
        expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
        const form = new URLSearchParams(String(calls[0].init?.body))
        expect(form.get('client_id')).toBe('hermes')
        expect(form.get('scope')).toBe('openid email offline_access')
    })

    it('keeps the interval and lifetime the server sends', async () => {
        mockFetch(json({ device_code: 'dc', verification_uri: 'u', interval: 2, expires_in: 60 }))
        expect(await auth.startDeviceFlow(endpoints)).toMatchObject({ interval: 2, expiresIn: 60 })
    })

    it('throws on a non-OK response', async () => {
        mockFetch(new Response('', { status: 500 }))
        await expect(auth.startDeviceFlow(endpoints)).rejects.toThrow('device authorization request failed (500)')
    })
})

describe('pollDeviceToken', () => {
    const endpoints = { deviceEndpoint: 'https://a.x/authorize', tokenEndpoint: 'https://a.x/token' }
    const start = { deviceCode: 'dc', verificationUri: 'u', interval: 5, expiresIn: 900 }

    function settle<T>(promise: Promise<T>) {
        return promise.then(
            value => ({ value, error: undefined as Error | undefined }),
            error => ({ value: undefined, error: error as Error }),
        )
    }

    it('returns the token once the user signed in, calling onPending while it waits', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        mockFetch(json({ error: 'authorization_pending' }, 400), json({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600, scope: 's' }))
        const onPending = vi.fn()
        const outcome = settle(auth.pollDeviceToken(endpoints, start, { onPending }))
        await vi.advanceTimersByTimeAsync(10_000)
        const { value } = await outcome
        expect(onPending).toHaveBeenCalledTimes(1)
        expect(value).toEqual({ accessToken: 'tok', refreshToken: 'ref', expiresAt: 1_010_000 + 3_600_000, scope: 's', obtainedAt: 1_010_000 })
        expect(calls[0].url).toBe('https://a.x/token')
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ device_code: 'dc' })
    })

    it('leaves expiry and refresh token unset when the server sends none', async () => {
        vi.useFakeTimers()
        mockFetch(json({ access_token: 'tok' }))
        const outcome = settle(auth.pollDeviceToken(endpoints, start))
        await vi.advanceTimersByTimeAsync(5_000)
        const { value } = await outcome
        expect(value).toMatchObject({ accessToken: 'tok', refreshToken: undefined, expiresAt: undefined, scope: undefined })
    })

    it('waits five more seconds after a slow_down', async () => {
        vi.useFakeTimers()
        mockFetch(json({ detail: 'slow_down' }), json({ access_token: 'tok' }))
        const outcome = settle(auth.pollDeviceToken(endpoints, start))
        await vi.advanceTimersByTimeAsync(5_000)
        expect(calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(9_999)
        expect(calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect((await outcome).value?.accessToken).toBe('tok')
    })

    it('throws when the server says the code expired', async () => {
        vi.useFakeTimers()
        mockFetch(json({ error: 'expired_token' }))
        const outcome = settle(auth.pollDeviceToken(endpoints, start))
        await vi.advanceTimersByTimeAsync(5_000)
        expect((await outcome).error?.message).toBe('the sign-in link expired before it was used')
    })

    it('throws any other error the server names', async () => {
        vi.useFakeTimers()
        mockFetch(json({ error: 'access_denied' }))
        const outcome = settle(auth.pollDeviceToken(endpoints, start))
        await vi.advanceTimersByTimeAsync(5_000)
        expect((await outcome).error?.message).toBe('authorization failed: access_denied')
    })

    it('reports the HTTP status of a body that is not JSON', async () => {
        vi.useFakeTimers()
        mockFetch(new Response('<html>bad gateway</html>', { status: 502 }))
        const outcome = settle(auth.pollDeviceToken(endpoints, start))
        await vi.advanceTimersByTimeAsync(5_000)
        expect((await outcome).error?.message).toBe('authorization failed: 502')
    })

    it('stops at maxWaitMs and says it is still waiting once the user was pending', async () => {
        vi.useFakeTimers()
        mockFetch(...Array.from({ length: 5 }, () => () => json({ error: 'authorization_pending' })))
        const outcome = settle(auth.pollDeviceToken(endpoints, start, { maxWaitMs: 12_000 }))
        await vi.advanceTimersByTimeAsync(20_000)
        expect((await outcome).error?.message).toMatch(/^still waiting for sign-in/)
        expect(calls).toHaveLength(3)
    })

    it('says the link expired when the deadline passed without a single poll', async () => {
        mockFetch()
        const { error } = await settle(auth.pollDeviceToken(endpoints, { ...start, expiresIn: 0 }))
        expect(error?.message).toBe('the sign-in link expired before it was used')
        expect(calls).toHaveLength(0)
    })
})

describe('token and pending storage', () => {
    const token = { accessToken: 'a', refreshToken: 'r', obtainedAt: 1 }

    it('saves, loads and clears a token', async () => {
        await auth.saveToken('store-agent', 'srv', token)
        expect(await auth.loadToken('store-agent', 'srv')).toEqual(token)
        await auth.clearToken('store-agent', 'srv')
        expect(await auth.loadToken('store-agent', 'srv')).toBeNull()
    })

    it('reads a corrupt token file as no token', async () => {
        await mkdir(mcpDir('corrupt-agent'), { recursive: true })
        await writeFile(mcpTokenPath('corrupt-agent', 'srv'), '{not json', 'utf8')
        await writeFile(mcpPendingPath('corrupt-agent', 'srv'), '{not json', 'utf8')
        expect(await auth.loadToken('corrupt-agent', 'srv')).toBeNull()
        expect(await auth.loadPending('corrupt-agent', 'srv')).toBeNull()
    })

    it('clears a missing token or pending sign-in without failing', async () => {
        await expect(auth.clearToken('nobody', 'srv')).resolves.toBeUndefined()
        await expect(auth.clearPending('nobody', 'srv')).resolves.toBeUndefined()
    })

    it('saves, loads and clears a pending sign-in', async () => {
        const pending = { auth: { deviceEndpoint: 'd', tokenEndpoint: 't' }, start: { deviceCode: 'dc', verificationUri: 'u', interval: 5, expiresIn: 900 }, startedAt: 7 }
        expect(await auth.loadPending('pending-agent', 'srv')).toBeNull()
        await auth.savePending('pending-agent', 'srv', pending)
        expect(await auth.loadPending('pending-agent', 'srv')).toEqual(pending)
        await auth.clearPending('pending-agent', 'srv')
        expect(await auth.loadPending('pending-agent', 'srv')).toBeNull()
    })

    it('keeps the folder and its files readable by the engine alone', async () => {
        const mode = async (path: string) => (await stat(path)).mode & 0o777
        const pending = { auth: { deviceEndpoint: 'd', tokenEndpoint: 't' }, start: { deviceCode: 'dc', verificationUri: 'u', interval: 5, expiresIn: 900 }, startedAt: 7 }
        await auth.saveToken('mode-agent', 'srv', token)
        await auth.savePending('mode-agent', 'srv', pending)
        expect(await mode(mcpDir('mode-agent'))).toBe(0o700)
        expect(await mode(mcpTokenPath('mode-agent', 'srv'))).toBe(0o600)
        expect(await mode(mcpPendingPath('mode-agent', 'srv'))).toBe(0o600)

        await chmod(mcpTokenPath('mode-agent', 'srv'), 0o644)
        await auth.saveToken('mode-agent', 'srv', { ...token, accessToken: 'rotated' })
        expect(await mode(mcpTokenPath('mode-agent', 'srv'))).toBe(0o600)
        expect(await auth.loadToken('mode-agent', 'srv')).toMatchObject({ accessToken: 'rotated' })
    })

    it('refuses a server name that would leave the mcp folder', async () => {
        await expect(auth.saveToken('store-agent', 'x/../y', token)).rejects.toBeInstanceOf(HttpError)
        await expect(auth.savePending('store-agent', '..', {} as never)).rejects.toMatchObject({ status: 400 })
    })

    it('reads a legacy name that is not a file name as nothing stored, so its agent keeps running', async () => {
        const legacy = { name: 'org/server', url: 'https://mcp.example.com', args: [], env: {}, headers: {} }
        expect(await auth.loadToken('store-agent', legacy.name)).toBeNull()
        expect(await auth.loadPending('store-agent', '..')).toBeNull()
        await expect(auth.clearToken('store-agent', legacy.name)).resolves.toBeUndefined()
        await expect(auth.clearPending('store-agent', legacy.name)).resolves.toBeUndefined()
        expect(await auth.withAuth('store-agent', legacy)).toBe(legacy)
    })
})

describe('withAuth', () => {
    const NOW = 5_000_000
    let agentSeq = 0
    const freshAgent = () => `auth-agent-${++agentSeq}`

    function frozenClock() {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
    }

    it('leaves a stdio server untouched', async () => {
        const stdio = server({ url: undefined, command: 'npx' })
        expect(await auth.withAuth(freshAgent(), stdio)).toBe(stdio)
    })

    it('leaves a server without a stored token untouched', async () => {
        const plain = server()
        expect(await auth.withAuth(freshAgent(), plain)).toBe(plain)
    })

    it('adds the bearer of a token without expiry', async () => {
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'live', obtainedAt: 1 })
        expect((await auth.withAuth(id, server({ headers: { 'x-extra': '1' } }))).headers).toEqual({ Authorization: 'Bearer live', 'x-extra': '1' })
    })

    it('lets an Authorization header set by the user win over the stored token', async () => {
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'stored', obtainedAt: 1 })
        expect((await auth.withAuth(id, server({ headers: { Authorization: 'Bearer mine' } }))).headers.Authorization).toBe('Bearer mine')
    })

    it('keeps a token that expires exactly 60 s from now without refreshing it', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'edge', refreshToken: 'r', tokenEndpoint: 'https://a.x/token', expiresAt: NOW + 60_000, obtainedAt: 1 })
        mockFetch()
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer edge')
        expect(calls).toHaveLength(0)
    })

    it('refreshes against the stored token endpoint with a form body and the client credentials', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', tokenEndpoint: 'https://a.x/token', clientId: 'cid', clientSecret: 'sec', expiresAt: NOW + 59_999, obtainedAt: 1 })
        mockFetch(json({ access_token: 'new', expires_in: 3600 }))

        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer new')

        expect(calls[0].url).toBe('https://a.x/token')
        expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
        expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1', client_id: 'cid', client_secret: 'sec' })
        expect(await auth.loadToken(id, 'linear')).toEqual({ accessToken: 'new', refreshToken: 'r1', expiresAt: NOW + 3_600_000, obtainedAt: NOW, tokenEndpoint: 'https://a.x/token', clientId: 'cid', clientSecret: 'sec' })
    })

    it('leaves the client fields out of the form when the token has none', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ access_token: 'new', refresh_token: 'r2' }))
        await auth.withAuth(id, server())
        expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' })
        expect((await auth.loadToken(id, 'linear'))?.refreshToken).toBe('r2')
    })

    it('refreshes once when two runs ask for the same expired token together', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }))

        const [first, second] = await Promise.all([auth.withAuth(id, server()), auth.withAuth(id, server())])

        expect(calls).toHaveLength(1)
        expect(first.headers.Authorization).toBe('Bearer new')
        expect(second.headers.Authorization).toBe('Bearer new')
        expect((await auth.loadToken(id, 'linear'))?.refreshToken).toBe('r2')
    })

    it('reads the refreshed token back once the refresh is over, without refreshing again', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }))
        await auth.withAuth(id, server())

        mockFetch()
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer new')
        expect(calls).toHaveLength(0)
    })

    it('refreshes each server of the same agent on its own', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old-l', refreshToken: 'rl', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        await auth.saveToken(id, 'notion', { accessToken: 'old-n', refreshToken: 'rn', tokenEndpoint: 'https://b.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ access_token: 'new-l' }), json({ access_token: 'new-n' }))

        const [linear, notion] = await Promise.all([auth.withAuth(id, server()), auth.withAuth(id, server({ name: 'notion' }))])

        expect(calls.map(c => c.url).sort()).toEqual(['https://a.x/token', 'https://b.x/token'])
        expect([linear.headers.Authorization, notion.headers.Authorization].sort()).toEqual(['Bearer new-l', 'Bearer new-n'])
    })

    it('refreshes a device-code token by rediscovering the token endpoint and posting JSON', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1, obtainedAt: 1 })
        mockFetch(json({ authorization_servers: ['https://auth.example.com/device/'] }), json({ access_token: 'new', refresh_token: 'r2' }))

        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer new')

        expect(calls.map(c => c.url)).toEqual(['https://mcp.example.com/.well-known/oauth-protected-resource', 'https://auth.example.com/device/token'])
        expect((calls[1].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
        expect(JSON.parse(String(calls[1].init?.body))).toEqual({ grant_type: 'refresh_token', client_id: 'hermes', refresh_token: 'r1' })
        expect(await auth.loadToken(id, 'linear')).toMatchObject({ accessToken: 'new', refreshToken: 'r2' })
    })

    it('keeps the old refresh token when the device refresh answer carries none', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ authorization_servers: ['https://auth.example.com/device'] }), json({ access_token: 'new' }))
        await auth.withAuth(id, server())
        expect(await auth.loadToken(id, 'linear')).toMatchObject({ accessToken: 'new', refreshToken: 'r1' })
    })

    it('sends the stale token when there is no refresh token to use', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'stale', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch()
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer stale')
        expect(calls).toHaveLength(0)

        const device = freshAgent()
        await auth.saveToken(device, 'linear', { accessToken: 'stale2', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(json({ authorization_servers: ['https://auth.example.com/device'] }))
        expect((await auth.withAuth(device, server())).headers.Authorization).toBe('Bearer stale2')
        expect(calls).toHaveLength(1)
    })

    it.each([
        ['the token endpoint rejects the grant', () => json({ error: 'invalid_grant' }, 400)],
        ['the token endpoint is unreachable', () => new Error('ECONNRESET')],
        ['the token endpoint answers garbage', () => new Response('oops', { status: 500 })],
    ])('sends the stale token when %s', async (_, response) => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'stale', refreshToken: 'r', tokenEndpoint: 'https://a.x/token', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(response())
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer stale')
        expect((await auth.loadToken(id, 'linear'))?.accessToken).toBe('stale')
    })

    it('sends the stale token when rediscovery fails or the device refresh is refused', async () => {
        frozenClock()
        const id = freshAgent()
        await auth.saveToken(id, 'linear', { accessToken: 'stale', refreshToken: 'r', expiresAt: NOW, obtainedAt: 1 })
        mockFetch(new Response('', { status: 404 }))
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer stale')

        mockFetch(json({ authorization_servers: ['https://auth.example.com/device'] }), new Error('socket hang up'))
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer stale')

        mockFetch(json({ authorization_servers: ['https://auth.example.com/device'] }), json({ error: 'invalid_grant' }))
        expect((await auth.withAuth(id, server())).headers.Authorization).toBe('Bearer stale')
    })
})

describe('deviceLogin', () => {
    it('refuses a stdio server', async () => {
        await expect(auth.deviceLogin('login-agent', server({ url: undefined, command: 'x' }), () => {})).rejects.toThrow('is stdio-based')
    })

    it('shows the prompt, polls and stores the token', async () => {
        vi.useFakeTimers()
        mockFetch(json({ authorization_servers: ['https://auth.example.com/device'] }), json({ device_code: 'dc', verification_uri: 'https://v', interval: 1 }), json({ access_token: 'tok' }))
        const prompts: unknown[] = []
        const pending = auth.deviceLogin('login-agent', server(), start => prompts.push(start))
        await vi.advanceTimersByTimeAsync(1_000)
        vi.useRealTimers()
        expect((await pending).accessToken).toBe('tok')
        expect(prompts).toEqual([{ deviceCode: 'dc', verificationUri: 'https://v', interval: 1, expiresIn: 900 }])
        expect((await auth.loadToken('login-agent', 'linear'))?.accessToken).toBe('tok')
    })
})
