import { vi } from 'vitest'

const state = vi.hoisted(() => ({
    servers: [] as { name: string; url?: string }[],
    env: { SECRET: 'x' } as Record<string, string>,
    events: [] as unknown[][],
    probes: {} as Record<string, unknown>,
    writes: [] as unknown[][],
}))

vi.mock('../../agents/registry.js', () => ({
    getAgent: async (id: string) => ({ id, config: { mcpServers: state.servers, tools: {} }, env: state.env }),
}))

vi.mock('../../tools/mcp-pool.js', () => ({
    agentMcpSpawn: (agent: { id: string; env: Record<string, string> }) => ({ cwd: `/ws/${agent.id}`, env: { PATH: '/usr/bin', ...agent.env } }),
}))

vi.mock('../../tools/mcp.js', () => ({
    probeMcp: async (agentId: string, server: { name: string }, env: unknown, opts: { spawn: unknown }) => {
        state.events.push(['probe', agentId, server.name, env, opts.spawn])
        return state.probes[server.name]
    },
}))

const configs: Record<string, unknown> = {}

vi.mock('../../agents/loader.js', async () => ({
    listAgentIdsOnDisk: async () => Object.keys(configs),
    readAgentConfig: async (id: string) => configs[id],
}))

vi.mock('../../agents/config-write.js', async () => {
    const actual = await vi.importActual<typeof import('../../agents/config-write.js')>('../../agents/config-write.js')
    return {
        ...actual,
        writeAgentConfig: async (id: string, config: unknown) => {
            state.writes.push([id, config])
        },
    }
})

vi.mock('../../tools/mcp-auth.js', () => ({
    deviceLogin: async (agentId: string, server: { name: string }, onPrompt: (start: { verificationUri: string }) => void) => {
        state.events.push(['deviceLogin', agentId, server.name])
        onPrompt({ verificationUri: 'https://auth.example.com/device' })
        return { accessToken: 'tok' }
    },
    clearToken: async (agentId: string, name: string) => {
        state.events.push(['clearToken', agentId, name])
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { mcpCommand } = await import('./mcp.js')
const { mcpServerSchema } = await import('../../agents/types.js')

let out = ''

beforeEach(() => {
    state.servers = []
    state.events = []
    state.probes = {}
    state.writes = []
    for (const id of Object.keys(configs)) delete configs[id]
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        out += String(chunk)
        return true
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('rerun mcp login', () => {
    it('runs the device flow and prints where to sign in', async () => {
        state.servers = [{ name: 'linear', url: 'https://mcp.linear.app' }]
        await mcpCommand(['login', 'agent1', 'linear'])
        expect(state.events).toEqual([['deviceLogin', 'agent1', 'linear']])
        expect(out).toBe('\nOpen this URL and sign in:\n  https://auth.example.com/device\n\nWaiting for authorization\nSigned in to linear. Token stored.\n')
    })

    it('refuses a server the agent does not have', async () => {
        state.servers = [{ name: 'linear' }]
        await expect(mcpCommand(['login', 'agent1', 'notion'])).rejects.toThrow('No MCP server "notion" registered for agent agent1')
        expect(state.events).toEqual([])
    })

    it('asks for both the agent and the server', async () => {
        await expect(mcpCommand(['login'])).rejects.toThrow('Usage: rerun mcp login <agentId> <server>')
        await expect(mcpCommand(['login', 'agent1'])).rejects.toThrow('Usage: rerun mcp login <agentId> <server>')
    })
})

describe('rerun mcp logout', () => {
    it('clears the stored token', async () => {
        await mcpCommand(['logout', 'agent1', 'linear'])
        expect(state.events).toEqual([['clearToken', 'agent1', 'linear']])
        expect(out).toBe('Cleared stored token for linear.\n')
    })

    it('asks for both the agent and the server', async () => {
        await expect(mcpCommand(['logout', 'agent1'])).rejects.toThrow('Usage: rerun mcp logout <agentId> <server>')
    })
})

describe('rerun mcp status', () => {
    it('probes every server with the agent env, spawned like a run, and prints one line each', async () => {
        state.servers = [{ name: 'linear' }, { name: 'broken' }]
        state.probes = {
            linear: { ok: true, transport: 'http', toolNames: ['a', 'b', 'c'] },
            broken: { ok: false, transport: 'sse', toolNames: [], error: 'HTTP 401' },
        }
        await mcpCommand(['status', 'agent1'])
        const spawn = { cwd: '/ws/agent1', env: { PATH: '/usr/bin', SECRET: 'x' } }
        expect(state.events).toEqual([
            ['probe', 'agent1', 'linear', { SECRET: 'x' }, spawn],
            ['probe', 'agent1', 'broken', { SECRET: 'x' }, spawn],
        ])
        expect(out).toBe('ok\tlinear\thttp\t3 tools\nfail\tbroken\tsse\tHTTP 401\n')
    })

    it('says so when the agent has no server', async () => {
        await mcpCommand(['status', 'agent1'])
        expect(out).toBe('No MCP servers registered.\n')
    })

    it('asks for the agent', async () => {
        await expect(mcpCommand(['status'])).rejects.toThrow('Usage: rerun mcp status <agentId>')
    })
})

describe('rerun mcp', () => {
    it('prints the usage for anything else', async () => {
        await expect(mcpCommand([])).rejects.toThrow('Usage: rerun mcp <login|logout|status|set-all>')
        await expect(mcpCommand(['add'])).rejects.toThrow('Usage: rerun mcp <login|logout|status|set-all>')
    })
})

describe('rerun mcp set-all', () => {
    it('replaces the named server only on coworkers that have it', async () => {
        const def = { name: 'everos', command: '/data/tools/bin/uv', args: ['run'], env: { EVEROS_TOKEN: '${EVEROS_TOKEN}' } }
        configs.a1 = { name: 'a1', mcpServers: [mcpServerSchema.parse({ name: 'everos', command: '/data/tools/bin/everos-mcp' })] }
        configs.a2 = { name: 'a2', mcpServers: [] }
        await mcpCommand(['set-all', 'everos'], async () => JSON.stringify(def))
        expect(state.writes).toEqual([['a1', { name: 'a1', mcpServers: [mcpServerSchema.parse(def)] }]])
        expect(out).toBe('updated a1\n1 of 2 coworkers had everos; restart the engine so running coworkers pick it up.\n')
    })

    it('writes the same result when run again', async () => {
        const def = { name: 'everos', command: '/data/tools/bin/uv' }
        configs.a1 = { name: 'a1', mcpServers: [mcpServerSchema.parse(def)] }
        await mcpCommand(['set-all', 'everos'], async () => JSON.stringify(def))
        expect(state.writes).toEqual([['a1', { name: 'a1', mcpServers: [mcpServerSchema.parse(def)] }]])
    })

    it('refuses bad JSON, another name or a missing name and writes nothing', async () => {
        configs.a1 = { name: 'a1', mcpServers: [] }
        await expect(mcpCommand(['set-all', 'everos'], async () => '{"name":')).rejects.toThrow('nothing written')
        await expect(mcpCommand(['set-all', 'everos'], async () => JSON.stringify({ name: 'other', command: 'x' }))).rejects.toThrow('nothing written')
        await expect(mcpCommand(['set-all'], async () => '')).rejects.toThrow('Usage: rerun mcp set-all <server>')
        expect(state.writes).toEqual([])
    })
})
