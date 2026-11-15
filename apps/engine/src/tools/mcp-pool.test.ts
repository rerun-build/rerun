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
    rejections: [] as unknown[],
    answer: null as unknown,
    listed: ['search'],
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
            return { tools: mcp.listed.map(name => ({ name, inputSchema: { type: 'object' } })) }
        }
        async callTool(request: { name: string }, _schema: unknown, options: unknown) {
            mcp.calls.push({ target: this.target, name: request.name, options })
            if (mcp.callGate) await mcp.callGate
            if (mcp.rejections.length) throw mcp.rejections.shift()
            if (mcp.answer) return mcp.answer
            return { content: [{ type: 'text', text: `${request.name} ran` }] }
        }
        async close() {
            mcp.closed.push(this.target)
            this.onclose?.()
        }
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { McpError } = await import('@modelcontextprotocol/sdk/types.js')
const { MCP_CONNECT_TIMEOUT_MS, MCP_IDLE_MS, acquireMcp, closeAllMcp, mcpSessionStates, pooledMcpCount, reconnectMcp, releaseAgentMcp } = await import('./mcp-pool.js')

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
    mcp.rejections.length = 0
    mcp.answer = null
    mcp.listed = ['search']
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

describe('picked tools', () => {
    it('hands out only the picked tools of a server', async () => {
        mcp.listed = ['a', 'b', 'c']
        const pooled = await acquireMcp('a1', server('gh', { tools: ['a', 'c'] }), spawn)
        expect(pooled?.tools.map(t => t.name)).toEqual(['a', 'c'])
    })

    it('ignores a picked name the server does not serve', async () => {
        mcp.listed = ['a', 'b']
        const pooled = await acquireMcp('a1', server('gh', { tools: ['a', 'zzz'] }), spawn)
        expect(pooled?.tools.map(t => t.name)).toEqual(['a'])
    })

    it('hands out every tool when nothing is picked, and when the list is empty', async () => {
        mcp.listed = ['a', 'b', 'c']
        const none = await acquireMcp('a1', server('gh'), spawn)
        const empty = await acquireMcp('a1', server('gh', { tools: [] }), spawn)
        expect(none?.tools.map(t => t.name)).toEqual(['a', 'b', 'c'])
        expect(empty?.tools.map(t => t.name)).toEqual(['a', 'b', 'c'])
    })

    it('refuses a call to a tool that is not picked and never reaches the server', async () => {
        mcp.listed = ['a', 'b', 'c']
        const pooled = await acquireMcp('a1', server('gh', { tools: ['a', 'c'] }), spawn)
        await expect(pooled?.call('b', {})).rejects.toThrow('tool "b" is not picked for server "gh"')
        expect(mcp.calls).toEqual([])
    })

    it('answers a picked tool as before', async () => {
        mcp.listed = ['a', 'b', 'c']
        const pooled = await acquireMcp('a1', server('gh', { tools: ['a', 'c'] }), spawn)
        expect(await pooled?.call('a', {})).toEqual({ content: [{ type: 'text', text: 'a ran' }] })
        expect(mcp.calls.map(c => c.name)).toEqual(['a'])
    })

    it('does not dial again when only the picks change', async () => {
        mcp.listed = ['a', 'b', 'c']
        await acquireMcp('a1', server('gh', { tools: ['a'] }), spawn)
        const again = await acquireMcp('a1', server('gh', { tools: ['b', 'c'] }), spawn)
        expect(mcp.connects).toHaveLength(1)
        expect(again?.tools.map(t => t.name)).toEqual(['b', 'c'])
    })
})

describe('a connection that dies during a call', () => {
    const ran = { content: [{ type: 'text', text: 'search ran' }] }
    const closed = () => new McpError(-32000, 'Connection closed')

    it('reconnects once and retries when the connection closes during a call', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.rejections.push(closed())
        expect(await pooled!.call('search', {})).toEqual(ran)
        expect(mcp.connects).toHaveLength(2)
        expect(mcp.calls).toHaveLength(2)
        expect(mcp.calls[1]!.target).toBe('https://gh.example/mcp')
    })

    it('reports the second failure and makes no third attempt', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        const second = closed()
        mcp.rejections.push(closed(), second)
        await expect(pooled!.call('search', {})).rejects.toBe(second)
        expect(mcp.calls).toHaveLength(2)
        expect(mcp.connects).toHaveLength(2)
    })

    it('does not retry a request timeout', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.rejections.push(new McpError(-32001, 'Request timed out'))
        await expect(pooled!.call('search', {})).rejects.toThrow('Request timed out')
        expect(mcp.calls).toHaveLength(1)
        expect(mcp.connects).toHaveLength(1)
    })

    it('does not retry another McpError', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.rejections.push(new McpError(-32602, 'Invalid params'))
        await expect(pooled!.call('search', {})).rejects.toThrow('Invalid params')
        expect(mcp.calls).toHaveLength(1)
    })

    it('does not retry a call whose signal was aborted', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        const controller = new AbortController()
        controller.abort()
        mcp.rejections.push(closed())
        await expect(pooled!.call('search', {}, { signal: controller.signal })).rejects.toThrow('Connection closed')
        expect(mcp.calls).toHaveLength(1)
        expect(mcp.connects).toHaveLength(1)
    })

    it('does not retry a result the server answered with isError', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        const failed = { isError: true, content: [{ type: 'text', text: 'tool failed' }] }
        mcp.answer = failed
        expect(await pooled!.call('search', {})).toBe(failed)
        expect(mcp.calls).toHaveLength(1)
        expect(mcp.connects).toHaveLength(1)
    })

    it.each(['ECONNRESET', 'EPIPE'])('retries on %s', async code => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.rejections.push(Object.assign(new Error(code), { code }))
        expect(await pooled!.call('search', {})).toEqual(ran)
        expect(mcp.calls).toHaveLength(2)
        expect(mcp.connects).toHaveLength(2)
    })

    it('answers server unreachable when the retry cannot dial', async () => {
        const pooled = await acquireMcp('a1', server('gh'), spawn)
        mcp.rejections.push(closed())
        mcp.failing.add('https://gh.example/mcp')
        await expect(pooled!.call('search', {})).rejects.toThrow('server "gh" unreachable')
        expect(mcp.calls).toHaveLength(1)
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

describe('reconnectMcp', () => {
    it('reconnectMcp closes the held connection and the next call of a handle taken earlier dials again and succeeds', async () => {
        const handle = await acquireMcp('a1', server('gh'), spawn)
        expect(reconnectMcp('a1', 'gh')).toBe(true)
        await settle()
        expect(mcp.closed).toEqual(['https://gh.example/mcp'])
        expect(await handle?.call('search', {})).toEqual({ content: [{ type: 'text', text: 'search ran' }] })
        expect(mcp.connects).toHaveLength(2)
        expect(pooledMcpCount()).toBe(1)
    })

    it('reconnectMcp answers false and closes nothing for a server the pool does not hold', async () => {
        expect(reconnectMcp('a1', 'gh')).toBe(false)
        await settle()
        expect(mcp.closed).toEqual([])
    })
})

describe('mcpSessionStates', () => {
    it('mcpSessionStates lists a held server as connected', async () => {
        await acquireMcp('a1', server('gh'), spawn)
        expect(mcpSessionStates('a1')).toEqual([{ name: 'gh', state: 'connected' }])
    })

    it('mcpSessionStates lists a server still opening as connecting', async () => {
        mcp.hanging.add('https://slow.example/mcp')
        void acquireMcp('a1', server('slow'), spawn)
        await settle()
        expect(mcpSessionStates('a1')).toEqual([{ name: 'slow', state: 'connecting' }])
        reconnectMcp('a1', 'slow')
    })

    it('mcpSessionStates lists a server that did not answer as failed with errorClass timeout, and drops it after a later success', async () => {
        vi.useFakeTimers()
        mcp.hanging.add('https://slow.example/mcp')
        const pending = acquireMcp('a1', server('slow'), spawn)
        await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS)
        expect(await pending).toBeNull()
        expect(mcpSessionStates('a1')).toEqual([{ name: 'slow', state: 'failed', errorClass: 'timeout' }])
        mcp.hanging.clear()
        vi.useRealTimers()
        expect(await acquireMcp('a1', server('slow'), spawn)).not.toBeNull()
        expect(mcpSessionStates('a1')).toEqual([{ name: 'slow', state: 'connected' }])
    })

    it('mcpSessionStates lists a refused server as failed with errorClass unreachable', async () => {
        mcp.failing.add('https://down.example/mcp')
        await acquireMcp('a1', server('down'), spawn)
        expect(mcpSessionStates('a1')).toEqual([{ name: 'down', state: 'failed', errorClass: 'unreachable' }])
    })

    it('mcpSessionStates never carries the error text', async () => {
        mcp.failing.add('https://down.example/mcp')
        await acquireMcp('a1', server('down'), spawn)
        await acquireMcp('a1', server('gh'), spawn)
        const states = mcpSessionStates('a1')
        expect(states.map(s => s.name)).toEqual(['down', 'gh'])
        for (const state of states) {
            expect(Object.keys(state).every(k => ['name', 'state', 'errorClass'].includes(k))).toBe(true)
            expect(['connected', 'connecting', 'failed']).toContain(state.state)
            if (state.errorClass) expect(['auth', 'timeout', 'unreachable', 'closed', 'other']).toContain(state.errorClass)
        }
        expect(JSON.stringify(states)).not.toContain('ECONNREFUSED')
    })

    it('mcpSessionStates answers only the agent asked for', async () => {
        await acquireMcp('a1', server('gh'), spawn)
        await acquireMcp('a2', server('linear'), spawn)
        expect(mcpSessionStates('a1')).toEqual([{ name: 'gh', state: 'connected' }])
        expect(mcpSessionStates('a3')).toEqual([])
    })
})

describe('releaseAgentMcp failures', () => {
    it('releaseAgentMcp clears the failures of the agent', async () => {
        mcp.failing.add('https://down.example/mcp')
        await acquireMcp('a1', server('down'), spawn)
        expect(mcpSessionStates('a1')).toHaveLength(1)
        releaseAgentMcp('a1')
        expect(mcpSessionStates('a1')).toEqual([])
    })
})
