import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

type FakeTransport = { kind: 'stdio' | 'sse' | 'http'; target: string; options: unknown }
type Behaviour = { connectError?: string; connectCode?: number; closeError?: string; hang?: boolean; tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }

const mcp = vi.hoisted(() => ({
    transports: [] as FakeTransport[],
    behaviours: new Map<string, Behaviour>(),
    calls: [] as Array<{ target: string; name: string; arguments: unknown }>,
    closed: [] as string[],
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: class {
        constructor(options: { command: string }) {
            Object.assign(this, { kind: 'stdio', target: options.command, options })
            mcp.transports.push(this as unknown as FakeTransport)
        }
    },
}))
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
    SSEClientTransport: class {
        constructor(url: URL, options: unknown) {
            Object.assign(this, { kind: 'sse', target: url.href, options })
            mcp.transports.push(this as unknown as FakeTransport)
        }
    },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class {
        constructor(url: URL, options: unknown) {
            Object.assign(this, { kind: 'http', target: url.href, options })
            mcp.transports.push(this as unknown as FakeTransport)
        }
    },
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        target = ''
        async connect(transport: FakeTransport) {
            this.target = transport.target
            const behaviour = mcp.behaviours.get(this.target)
            if (behaviour?.hang) await new Promise(resolve => setTimeout(resolve, 50))
            if (behaviour?.connectError) throw Object.assign(new Error(behaviour.connectError), behaviour.connectCode ? { code: behaviour.connectCode } : {})
        }
        async listTools() {
            return { tools: mcp.behaviours.get(this.target)?.tools ?? [] }
        }
        async callTool(request: { name: string; arguments: unknown }) {
            mcp.calls.push({ target: this.target, ...request })
            return { content: [{ type: 'text', text: `${request.name} ran` }] }
        }
        async close() {
            mcp.closed.push(this.target)
            const error = mcp.behaviours.get(this.target)?.closeError
            if (error) throw new Error(error)
        }
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { probeMcp, resolveTransport } = await import('./mcp.js')
const { closeAllMcp, pooledMcpTools } = await import('./mcp-pool.js')
const { workspaceDir } = await import('../config/paths.js')

type Server = Parameters<typeof resolveTransport>[0]

function server(overrides: Partial<Server>): Server {
    return { name: 'srv', args: [], env: {}, headers: {}, ...overrides }
}

function agentWith(servers: Server[], env: Record<string, string> = {}) {
    return { id: 'mcp-agent', env, config: { mcpServers: servers, tools: {} } } as any
}

// The pool closes asynchronously: the clients a test left open are closed before the next one counts.
beforeEach(async () => {
    closeAllMcp()
    await new Promise(resolve => setTimeout(resolve, 0))
    mcp.transports.length = 0
    mcp.behaviours.clear()
    mcp.calls.length = 0
    mcp.closed.length = 0
})

describe('resolveTransport', () => {
    it.each([
        [{ transport: 'sse', url: 'https://x.io/mcp' }, 'sse'],
        [{ transport: 'http', command: 'npx' }, 'http'],
        [{ command: 'npx', url: 'https://x.io/sse' }, 'stdio'],
        [{ url: 'https://x.io/sse' }, 'sse'],
        [{ url: 'https://x.io/sse///' }, 'sse'],
        [{ url: 'https://x.io/mcp' }, 'http'],
        [{ url: 'https://x.io/sse/extra' }, 'http'],
        [{}, 'stdio'],
    ] as const)('resolves %j to %s', (overrides, expected) => {
        expect(resolveTransport(server(overrides))).toBe(expected)
    })
})

describe('pooledMcpTools', () => {
    it('exposes each tool as <server>_<tool> and runs it through the client', async () => {
        mcp.behaviours.set('https://gh.example/mcp', {
            tools: [{ name: 'search', description: 'Search issues', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }, { name: 'ping' }],
        })
        const tools = await pooledMcpTools(agentWith([server({ name: 'gh', url: 'https://gh.example/mcp' })]))

        expect(Object.keys(tools)).toEqual(['gh_search', 'gh_ping'])
        expect(tools.gh_search.description).toBe('Search issues')
        expect(tools.gh_ping.description).toBe('ping')
        expect((tools.gh_ping.inputSchema as { jsonSchema: unknown }).jsonSchema).toEqual({ type: 'object' })

        const result = await (tools.gh_search as any).execute({ q: 'bug' }, { toolCallId: 'c', messages: [] })
        expect(result).toBe(JSON.stringify([{ type: 'text', text: 'search ran' }]))
        expect(mcp.calls).toEqual([{ target: 'https://gh.example/mcp', name: 'search', arguments: { q: 'bug' } }])
    })

    it('lifts a root oneOf out of a tool schema and tells the model the rule it carried', async () => {
        mcp.behaviours.set('https://tt.example/mcp', {
            tools: [
                {
                    name: 'scan_ad',
                    description: 'Deep-scan an ad',
                    inputSchema: { type: 'object', properties: { ad_identifier: { type: 'string' }, collation_id: { type: 'string' } }, oneOf: [{ required: ['ad_identifier'] }, { required: ['collation_id'] }] },
                },
            ],
        })
        const tools = await pooledMcpTools(agentWith([server({ name: 'tt', url: 'https://tt.example/mcp' })]))

        expect(tools.tt_scan_ad.description).toBe('Deep-scan an ad\n\nProvide exactly one of: ad_identifier, collation_id.')
        expect((tools.tt_scan_ad.inputSchema as { jsonSchema: unknown }).jsonSchema).toEqual({
            type: 'object',
            properties: { ad_identifier: { type: 'string' }, collation_id: { type: 'string' } },
        })
    })

    it('drops a server that fails to connect and one with neither command nor url, keeping the others', async () => {
        mcp.behaviours.set('https://down.example/mcp', { connectError: 'ECONNREFUSED' })
        mcp.behaviours.set('https://up.example/mcp', { tools: [{ name: 'list' }] })
        const tools = await pooledMcpTools(
            agentWith([server({ name: 'down', url: 'https://down.example/mcp' }), server({ name: 'empty' }), server({ name: 'up', url: 'https://up.example/mcp' })]),
        )
        expect(Object.keys(tools)).toEqual(['up_list'])
    })

    it('closes every pooled client and swallows a close failure', async () => {
        mcp.behaviours.set('https://a.example/mcp', { tools: [], closeError: 'already closed' })
        mcp.behaviours.set('https://b.example/mcp', { tools: [] })
        await pooledMcpTools(agentWith([server({ name: 'a', url: 'https://a.example/mcp' }), server({ name: 'b', url: 'https://b.example/mcp' })]))
        closeAllMcp()
        await vi.waitFor(() => expect(mcp.closed.sort()).toEqual(['https://a.example/mcp', 'https://b.example/mcp']))
    })

    it('returns no tools for an agent without servers', async () => {
        expect(await pooledMcpTools(agentWith([]))).toEqual({})
    })

    it('resolves ${VAR} placeholders from the agent env before dialing', async () => {
        await pooledMcpTools(agentWith([server({ name: 'lin', url: 'https://lin.example/mcp', headers: { Authorization: 'Bearer ${LINEAR_KEY}' } })], { LINEAR_KEY: 'k1' }))
        expect(mcp.transports[0]).toMatchObject({ kind: 'http', target: 'https://lin.example/mcp', options: { requestInit: { headers: { Authorization: 'Bearer k1' } } } })
    })

    // A stdio server runs as the CLI started it: the engine's bare essentials, the agent's keys and
    // its workspace, never the engine's own secrets.
    it('builds each transport with its own options, a stdio server in the agent workspace', async () => {
        process.env.MCP_TEST_INHERITED = 'yes'
        await pooledMcpTools(
            agentWith(
                [
                    server({ name: 'local', command: 'node', args: ['srv.js'], env: { TOKEN: 't' } }),
                    server({ name: 'stream', url: 'https://s.example/sse' }),
                    server({ name: 'plain', url: 'https://p.example/mcp' }),
                    server({ name: 'forced', transport: 'sse', url: 'https://f.example/events', headers: { 'x-k': 'v' } }),
                ],
                { AGENT_KEY: 'a' },
            ),
        )
        const byTarget = Object.fromEntries(mcp.transports.map(t => [t.target, t]))
        const stdio = byTarget.node.options as { command: string; args: string[]; env: Record<string, string>; cwd: string }
        expect(stdio.args).toEqual(['srv.js'])
        expect(stdio.cwd).toBe(workspaceDir('mcp-agent'))
        expect(stdio.env).toMatchObject({ TOKEN: 't', AGENT_KEY: 'a', PATH: process.env.PATH, HOME: process.env.HOME, RERUN_WORKSPACE: workspaceDir('mcp-agent') })
        expect(stdio.env.MCP_TEST_INHERITED).toBeUndefined()
        expect(stdio.env).not.toHaveProperty('RERUN_API_KEY')
        expect(stdio.env).not.toHaveProperty('RERUN_DATA_DIR')
        expect(byTarget['https://s.example/sse']).toMatchObject({ kind: 'sse', options: undefined })
        expect(byTarget['https://p.example/mcp']).toMatchObject({ kind: 'http', options: undefined })
        expect(byTarget['https://f.example/events']).toMatchObject({ kind: 'sse', options: { requestInit: { headers: { 'x-k': 'v' } } } })
    })

    it('fails a server forced to a transport it has no endpoint for', async () => {
        const tools = await pooledMcpTools(agentWith([server({ name: 'odd', transport: 'http', command: 'npx' }), server({ name: 'odd2', transport: 'stdio', url: 'https://x.io/mcp' })]))
        expect(tools).toEqual({})
        expect(mcp.transports).toHaveLength(0)
    })
})

const spawn = { cwd: '/agents/mcp-agent/workspace', env: { PATH: '/usr/bin', AGENT_KEY: 'a' } }

describe('probeMcp', () => {
    // A probe the agent asked for (mcp_register, mcp_status) spawns the command like a run would:
    // the engine's own environment, and its API key, stay out of it.
    it('dials a stdio server in the agent workspace with the spawn env, never the engine one', async () => {
        process.env.MCP_TEST_INHERITED = 'yes'
        await probeMcp('mcp-agent', server({ name: 'local', command: 'node', args: ['srv.js'], env: { TOKEN: 't' } }), {}, { spawn })
        const options = mcp.transports[0]!.options as { env: Record<string, string>; cwd?: string }
        expect(options.env).toEqual({ PATH: '/usr/bin', AGENT_KEY: 'a', TOKEN: 't' })
        expect(options.cwd).toBe('/agents/mcp-agent/workspace')
    })

    it('lists the tool names and closes the client even when close fails', async () => {
        mcp.behaviours.set('https://ok.example/mcp', { tools: [{ name: 'a' }, { name: 'b' }], closeError: 'boom' })
        expect(await probeMcp('mcp-agent', server({ name: 'ok', url: 'https://ok.example/mcp' }), {}, { spawn })).toEqual({ ok: true, transport: 'http', toolNames: ['ok_a', 'ok_b'] })
        expect(mcp.closed).toEqual(['https://ok.example/mcp'])
    })

    it('reports the connection error with the transport it tried', async () => {
        mcp.behaviours.set('https://no.example/sse', { connectError: 'HTTP 401 Unauthorized' })
        expect(await probeMcp('mcp-agent', server({ name: 'no', url: 'https://no.example/sse' }), {}, { spawn })).toEqual({ ok: false, transport: 'sse', toolNames: [], error: 'HTTP 401 Unauthorized' })
    })

    it('closes the client of a server that fails during the handshake', async () => {
        mcp.behaviours.set('https://half.example/mcp', { connectError: 'HTTP 500' })
        await probeMcp('mcp-agent', server({ name: 'half', url: 'https://half.example/mcp' }), {}, { spawn })
        expect(mcp.closed).toEqual(['https://half.example/mcp'])
    })

    it('gives up on a server that does not answer within the deadline, and closes it once it does', async () => {
        mcp.behaviours.set('https://slow.example/mcp', { hang: true, tools: [{ name: 'a' }] })
        expect(await probeMcp('mcp-agent', server({ name: 'slow', url: 'https://slow.example/mcp' }), {}, { spawn, timeoutMs: 5 })).toEqual({
            ok: false,
            transport: 'http',
            toolNames: [],
            error: 'no answer within 0s',
        })
        await vi.waitFor(() => expect(mcp.closed).toEqual(['https://slow.example/mcp']))
    })

    it('names the HTTP status the SDK keeps out of its message, so a bare 401 reads as a sign-in', async () => {
        mcp.behaviours.set('https://linear.example/mcp', { connectError: 'Streamable HTTP error: Error POSTing to endpoint: ', connectCode: 401 })
        expect((await probeMcp('mcp-agent', server({ name: 'linear', url: 'https://linear.example/mcp' }), {}, { spawn })).error).toBe('Streamable HTTP error: Error POSTing to endpoint: (HTTP 401)')
    })

    it('reports a server with nothing to dial', async () => {
        expect(await probeMcp('mcp-agent', server({ name: 'bare' }), {}, { spawn })).toEqual({
            ok: false,
            transport: 'stdio',
            toolNames: [],
            error: 'server "bare" needs a command (stdio) or a url (sse/http)',
        })
    })
})
