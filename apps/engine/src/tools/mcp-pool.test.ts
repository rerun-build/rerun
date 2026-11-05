import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-pool-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const mcp = vi.hoisted(() => ({
    connects: [] as string[],
    closed: [] as string[],
    calls: [] as Array<{ target: string; name: string; options: unknown }>,
    failing: new Set<string>(),
    hanging: new Set<string>(),
    clients: [] as Array<{ target: string; onclose?: () => void }>,
    callGate: null as Promise<void> | null,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: class {
        constructor(options: { command: string }) {
            Object.assign(this, { target: options.command })
        }
    },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class {
        constructor(url: URL) {
            Object.assign(this, { target: url.href })
        }
    },
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        target = ''
        onclose?: () => void
        async connect(transport: { target: string }) {
            this.target = transport.target
            mcp.connects.push(this.target)
            mcp.clients.push(this)
            if (mcp.hanging.has(this.target)) await new Promise(() => {})
            if (mcp.failing.has(this.target)) throw new Error('ECONNREFUSED')
        }
        async listTools() {
            return { tools: [{ name: 'search', inputSchema: { type: 'object' } }] }
        }
        async callTool(request: { name: string }, _schema: unknown, options: unknown) {
            mcp.calls.push({ target: this.target, name: request.name, options })
            if (mcp.callGate) await mcp.callGate
            return { content: [{ type: 'text', text: `${request.name} ran` }] }
        }
        async close() {
            mcp.closed.push(this.target)
            this.onclose?.()
        }
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { MCP_CONNECT_TIMEOUT_MS, MCP_IDLE_MS, acquireMcp, closeAllMcp, pooledMcpCount, releaseAgentMcp } = await import('./mcp-pool.js')

type Server = Parameters<typeof acquireMcp>[1]

const spawn = { cwd: '/w', env: { PATH: '/usr/bin' } }
const server = (name: string, overrides: Partial<Server> = {}): Server => ({ name, url: `https://${name}.example/mcp`, args: [], env: {}, headers: {}, ...overrides })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(async () => {
    await closeAllMcp()
    mcp.connects.length = 0
    mcp.closed.length = 0
    mcp.calls.length = 0
    mcp.clients.length = 0
    mcp.failing.clear()
    mcp.hanging.clear()
    mcp.callGate = null
})

afterEach(() => {
    vi.useRealTimers()
})

describe('acquireMcp', () => {
    it('keeps one connection per agent and server across runs', async () => {
        const first = await acquireMcp('a1', server('gh'), spawn)
        const second = await acquireMcp('a1', server('gh'), spawn)
        await acquireMcp('a2', server('gh'), spawn)

        expect(mcp.connects).toEqual(['https://gh.example/mcp', 'https://gh.example/mcp'])
        expect(first?.tools.map(t => t.name)).toEqual(['search'])
        expect(await second?.call('search', { q: 'x' }, { timeout: 5 })).toEqual({ content: [{ type: 'text', text: 'search ran' }] })
        expect(mcp.calls).toEqual([{ target: 'https://gh.example/mcp', name: 'search', options: { timeout: 5 } }])
        expect(pooledMcpCount()).toBe(2)
    })

    it('dials again, and closes the old connection, when the server is dialed differently', async () => {
        await acquireMcp('a1', server('gh', { headers: { Authorization: 'Bearer old' } }), spawn)
        await acquireMcp('a1', server('gh', { headers: { Authorization: 'Bearer new' } }), spawn)
        await settle()

        expect(mcp.connects).toHaveLength(2)
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
        expect(pooledMcpCount()).toBe(1)
    })

    it('answers null for a server it cannot reach, and tries it again on the next run', async () => {
        mcp.failing.add('https://down.example/mcp')
        expect(await acquireMcp('a1', server('down'), spawn)).toBeNull()
        mcp.failing.clear()
        expect(await acquireMcp('a1', server('down'), spawn)).not.toBeNull()
        expect(mcp.connects).toHaveLength(2)
    })

    it('leaves out a server that does not answer in time, and dials it afresh next time', async () => {
        vi.useFakeTimers()
        mcp.hanging.add('https://slow.example/mcp')
        const pending = acquireMcp('a1', server('slow'), spawn)
        await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS)
        expect(await pending).toBeNull()
        expect(pooledMcpCount()).toBe(0)
    })

    it('closes a connection left unused for the idle spell', async () => {
        vi.useFakeTimers()
        await acquireMcp('a1', server('gh'), spawn)
        await vi.advanceTimersByTimeAsync(MCP_IDLE_MS - 1)
        expect(mcp.closed).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
        expect(pooledMcpCount()).toBe(0)
    })

    it('keeps a connection open while a call is still out, and closes it once idle after', async () => {
        vi.useFakeTimers()
        let answer!: () => void
        mcp.callGate = new Promise(resolve => (answer = resolve))
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        const call = pooled!.call('search', {})
        await vi.advanceTimersByTimeAsync(MCP_IDLE_MS * 2)
        expect(mcp.closed).toEqual([])

        answer()
        await call
        await vi.advanceTimersByTimeAsync(MCP_IDLE_MS)
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
    })

    it('forgets a connection the server closed, and dials it again', async () => {
        await acquireMcp('a1', server('gh'), spawn)
        mcp.clients[0]!.onclose?.()
        expect(pooledMcpCount()).toBe(0)
        await acquireMcp('a1', server('gh'), spawn)
        expect(mcp.connects).toHaveLength(2)
    })

    // A run can go longer than the idle spell between two MCP calls: the handle it holds must not
    // be stuck on the client the pool closed meanwhile.
    it('dials again on a call made after the idle spell closed the connection', async () => {
        vi.useFakeTimers()
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        await vi.advanceTimersByTimeAsync(MCP_IDLE_MS)
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
        expect(pooledMcpCount()).toBe(0)

        expect(await pooled!.call('search', {})).toEqual({ content: [{ type: 'text', text: 'search ran' }] })
        expect(mcp.connects).toHaveLength(2)
        expect(mcp.calls.map(c => c.target)).toEqual(['https://gh.example/mcp'])
        expect(pooledMcpCount()).toBe(1)
    })

    it('answers a call on a connection the server closed from a fresh one', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.clients[0]!.onclose?.()
        expect(await pooled!.call('search', {})).toEqual({ content: [{ type: 'text', text: 'search ran' }] })
        expect(mcp.connects).toHaveLength(2)
        expect(mcp.calls).toHaveLength(1)
    })

    it('fails a call when the server cannot be reached again', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.clients[0]!.onclose?.()
        mcp.failing.add('https://gh.example/mcp')
        await expect(pooled!.call('search', {})).rejects.toThrow('server "gh" unreachable')
        expect(mcp.calls).toHaveLength(0)
    })
})

describe('closeAllMcp', () => {
    it('resolves once every connection is closed', async () => {
        await acquireMcp('a1', server('gh'), spawn)
        await acquireMcp('a2', server('linear'), spawn)
        await closeAllMcp()
        expect(mcp.closed.sort()).toEqual(['https://gh.example/mcp', 'https://linear.example/mcp'])
        expect(pooledMcpCount()).toBe(0)
    })
})

describe('releaseAgentMcp', () => {
    it("closes the agent's connections, sparing the servers it still declares and other agents", async () => {
        await acquireMcp('a1', server('gh'), spawn)
        await acquireMcp('a1', server('linear'), spawn)
        await acquireMcp('a2', server('gh'), spawn)

        releaseAgentMcp('a1', ['linear'])
        await settle()
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
        expect(pooledMcpCount()).toBe(2)

        releaseAgentMcp('a1')
        await settle()
        expect(mcp.closed).toEqual(['https://gh.example/mcp', 'https://linear.example/mcp'])
        expect(pooledMcpCount()).toBe(1)
    })
})
