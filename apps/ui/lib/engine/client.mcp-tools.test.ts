import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAgentToolList, listMcpServerTools } from './client'

const conn = { baseUrl: 'https://engine.test', apiKey: 'k' }

function stubFetch(respond: () => Response) {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => respond())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('engine client tool sizes', () => {
    it('reads the tools of one server from the encoded path, sizes and picks kept', async () => {
        const body = { name: 'a/b c', picks: ['search'], tools: [{ name: 'search', description: 'Find', tokens: 31, picked: true }, { name: 'edit', description: 'Change', tokens: 12, picked: false }] }
        const fetchMock = stubFetch(() => Response.json(body))
        const result = await listMcpServerTools(conn, 'a1', 'a/b c')
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/agents/a1/mcp-servers/a%2Fb%20c/tools')
        expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
        expect(result).toEqual(body)
    })

    it('refuses an answer that is not a tool list', async () => {
        stubFetch(() => Response.json({ name: 'a', tools: [{ name: 'x' }] }))
        await expect(listMcpServerTools(conn, 'a1', 'a')).rejects.toThrow()
    })

    it('reads the built-in families with their sizes and the size of the instructions', async () => {
        const body = { families: [{ family: 'shell', description: 'Run', enabled: true, tokens: 162, tools: [{ name: 'shell_exec', description: 'Run a command', tokens: 162 }] }], promptTokens: 5400 }
        const fetchMock = stubFetch(() => Response.json(body))
        const result = await getAgentToolList(conn, 'a/1')
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/agents/a%2F1/tools')
        expect(result).toEqual(body)
    })

    it('answers an older engine without sizes as it came', async () => {
        const body = { families: [{ family: 'shell', description: 'Run', enabled: true, tools: [{ name: 'shell_exec', description: 'Run a command' }] }] }
        stubFetch(() => Response.json(body))
        expect(await getAgentToolList(conn, 'a1')).toEqual(body)
    })
})
