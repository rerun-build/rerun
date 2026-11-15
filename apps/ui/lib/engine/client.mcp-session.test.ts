import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMcpSessionStates, reconnectMcpServer } from './client'

const conn = { baseUrl: 'https://engine.test', apiKey: 'k' }

function stubFetch(respond: () => Response) {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => respond())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('engine client mcp session', () => {
    it('reads the session states from the encoded path and returns the servers', async () => {
        const servers = [{ name: 'a', state: 'connected' }, { name: 'b', state: 'failed', errorClass: 'auth' }]
        const fetchMock = stubFetch(() => Response.json({ servers }))
        const result = await getMcpSessionStates(conn, 'a/1')
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/agents/a%2F1/mcp-servers/session')
        expect(result).toEqual(servers)
    })

    it('answers null for a 404', async () => {
        stubFetch(() => new Response('not found', { status: 404 }))
        expect(await getMcpSessionStates(conn, 'a1')).toBeNull()
    })

    it('posts the reconnect to the encoded path, so a name of "a/b c" cannot leave it', async () => {
        const body = { name: 'a/b c', reconnected: true, effect: 'next_call', announced: 2 }
        const fetchMock = stubFetch(() => Response.json(body))
        const result = await reconnectMcpServer(conn, 'a1', 'a/b c')
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/agents/a1/mcp-servers/a%2Fb%20c/reconnect')
        expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
        expect(result).toEqual(body)
    })

    it('refuses an answer that is not a reconnect result', async () => {
        stubFetch(() => Response.json({ ok: true }))
        await expect(reconnectMcpServer(conn, 'a1', 'a')).rejects.toThrow()
    })
})
