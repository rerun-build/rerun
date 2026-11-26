import { readFileSync } from 'node:fs'
import { vi } from 'vitest'

const tokens = vi.hoisted(() => ({ refreshes: [] as (string | undefined)[], next: 'access-2' }))

vi.mock('./grok-token.js', () => ({
    grokAccessToken: (connection: { env: Record<string, string> }) => connection.env.GROK_OAUTH_TOKEN,
    ensureGrokToken: async (connection: { env: Record<string, string> }, options: { rejectedToken?: string } = {}) => {
        if (options.rejectedToken === undefined) return
        tokens.refreshes.push(options.rejectedToken)
        connection.env.GROK_OAUTH_TOKEN = tokens.next
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { grokClientVersion, grokFetch, minimumClientVersionOf, resetGrokClientVersionForTests } = await import('./grok-proxy.js')

type Sent = { url: string; headers: Headers; body: Record<string, unknown> | null; redirect: RequestRedirect | undefined }

function grokConnection(token = 'access-1') {
    return { id: 'grokcnx', config: { name: 'Grok', provider: 'grok' as const, models: ['grok-4.6'], extraModels: [], createdAt: '' }, env: { GROK_OAUTH_TOKEN: token } }
}

function proxy(answers: (() => Response)[]) {
    const sent: Sent[] = []
    const inner = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(input), headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null, redirect: init?.redirect })
        const answer = answers.shift()
        if (!answer) throw new Error('no answer left')
        return answer()
    })
    return { sent, inner: inner as unknown as typeof fetch }
}

beforeEach(() => {
    tokens.refreshes = []
    tokens.next = 'access-2'
    resetGrokClientVersionForTests()
})

describe('grokFetch', () => {
    it('sends what Grok Build sends, with the token of the moment and the conversation', async () => {
        const { sent, inner } = proxy([() => Response.json({}), () => Response.json({})])
        const connection = grokConnection()
        const send = grokFetch({ connection, sessionId: 'session-1' }, inner)
        await send('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer grok-sign-in' } })
        connection.env.GROK_OAUTH_TOKEN = 'access-refreshed-meanwhile'
        await send('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{}' })

        expect(sent[0]!.headers.get('authorization')).toBe('Bearer access-1')
        expect(sent[1]!.headers.get('authorization')).toBe('Bearer access-refreshed-meanwhile')
        expect(Object.fromEntries([...sent[0]!.headers].filter(([name]) => name.startsWith('x-')))).toMatchObject({
            'x-grok-client-version': '1.0.92',
            'x-grok-client-surface': 'headless',
            'x-grok-client-identifier': 'rerun',
            'x-xai-token-auth': 'xai-grok-cli',
            'x-authenticateresponse': 'authenticate-response',
            'x-grok-conv-id': 'session-1',
        })
        expect(sent[0]!.headers.get('x-grok-req-id')).not.toBe(sent[1]!.headers.get('x-grok-req-id'))
        expect(sent.every(request => request.redirect === 'error')).toBe(true)
    })

    it('never sends the token anywhere but the proxy', async () => {
        const { inner } = proxy([])
        const send = grokFetch({ connection: grokConnection(), sessionId: 's' }, inner)
        await expect(send('https://api.x.ai/v1/responses', { method: 'POST' })).rejects.toThrow('https://cli-chat-proxy.grok.com')
        await expect(send('https://cli-chat-proxy.grok.com.evil.example/v1/responses', { method: 'POST' })).rejects.toThrow()
        expect(inner).not.toHaveBeenCalled()
    })

    it('renews a refused token once and tries once more', async () => {
        const { sent, inner } = proxy([() => Response.json({ error: 'Invalid or expired credentials' }, { status: 401 }), () => Response.json({ ok: true })])
        const response = await grokFetch({ connection: grokConnection(), sessionId: 's' }, inner)('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{"a":1}' })
        expect(response.status).toBe(200)
        expect(tokens.refreshes).toEqual(['access-1'])
        expect(sent.map(request => request.headers.get('authorization'))).toEqual(['Bearer access-1', 'Bearer access-2'])
        expect(sent[1]!.body).toEqual({ a: 1 })
    })

    it('hands a second 401 to the caller rather than looping', async () => {
        const { sent, inner } = proxy([() => new Response('{}', { status: 401 }), () => new Response('{}', { status: 401 })])
        const response = await grokFetch({ connection: grokConnection(), sessionId: 's' }, inner)('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{}' })
        expect(response.status).toBe(401)
        expect(sent).toHaveLength(2)
    })

    it('takes up the client version the proxy asks for, for every later request too', async () => {
        const outdated = () => Response.json({ error: 'Your Grok CLI version (1.0.92) is outdated. Please update to version 1.1.4 or later via `grok update` or the installation documentation.' }, { status: 426 })
        const { sent, inner } = proxy([outdated, () => Response.json({}), () => Response.json({})])
        const send = grokFetch({ connection: grokConnection(), sessionId: 's' }, inner)
        expect((await send('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{}' })).status).toBe(200)
        await send('https://cli-chat-proxy.grok.com/v1/models', {})
        expect(sent.map(request => request.headers.get('x-grok-client-version'))).toEqual(['1.0.92', '1.1.4', '1.1.4'])
        expect(grokClientVersion()).toBe('1.1.4')
    })

    it('never steps back to an older version, nor tries again for one it already sends', async () => {
        const stale = () => Response.json({ error: 'Your Grok CLI version (1.0.92) is outdated. Please update to version 1.0.13 or later.' }, { status: 426 })
        const { sent, inner } = proxy([stale])
        const response = await grokFetch({ connection: grokConnection(), sessionId: 's' }, inner)('https://cli-chat-proxy.grok.com/v1/responses', { method: 'POST', body: '{}' })
        expect(response.status).toBe(426)
        expect(sent).toHaveLength(1)
        expect(grokClientVersion()).toBe('1.0.92')
    })

    it('reads the version out of the refusal, and nothing out of anything else', () => {
        expect(minimumClientVersionOf('Your Grok CLI version (none) is outdated. Please update to version 1.0.13 or later via `grok update`')).toBe('1.0.13')
        expect(minimumClientVersionOf('{"error":"upstream"}')).toBeNull()
    })
})
