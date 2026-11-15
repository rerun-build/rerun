import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-reconnect-'))

type State = { name: string; state: 'connected' | 'connecting' | 'failed'; errorClass?: string }

const mocks = vi.hoisted(() => ({
    states: [] as State[],
    held: new Set<string>(),
    dropped: [] as string[],
    announced: [] as unknown[],
    live: 0,
    provider: 'anthropic',
}))

vi.mock('../../tools/mcp-pool.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../tools/mcp-pool.js')>()),
    mcpSessionStates: () => mocks.states,
    reconnectMcp: (_agentId: string, name: string) => {
        mocks.dropped.push(name)
        return mocks.held.has(name)
    },
}))

vi.mock('../../runtime/run-control.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../runtime/run-control.js')>()),
    announceToAgentRuns: (_agentId: string, part: unknown) => {
        mocks.announced.push(part)
        return mocks.live
    },
}))

vi.mock('../../agents/loader.js', async importOriginal => {
    const original = await importOriginal<typeof import('../../agents/loader.js')>()
    return {
        ...original,
        loadAgentView: async (id: string) => {
            const view = await original.loadAgentView(id)
            return { ...view, resolved: { ...view.resolved, provider: mocks.provider } }
        },
    }
})

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { agentRoutes } = await import('./agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { mcpSessionStateListSchema, mcpReconnectResultSchema, mcpReconnectEventSchema } = await import('@rerun/contracts')

const id = 'reconnectagent'

const http = (name: string) => ({ name, transport: 'http', url: `https://${name}.example/mcp` })

const post = (name: string, agent = id) => agentRoutes.request(`/${agent}/mcp-servers/${name}/reconnect`, { method: 'POST' })

beforeEach(async () => {
    mocks.states = []
    mocks.held.clear()
    mocks.dropped.length = 0
    mocks.announced.length = 0
    mocks.live = 0
    mocks.provider = 'anthropic'
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'reconnect', mcpServers: [http('linear'), http('notion'), http('down'), http('rerun')] }))
})

describe('GET /agents/:id/mcp-servers/session', () => {
    it('lists declared servers with the pool state, idle when the pool holds none, never the bridge', async () => {
        mocks.states = [
            { name: 'linear', state: 'connected' },
            { name: 'rerun', state: 'connected' },
        ]
        const res = await agentRoutes.request(`/${id}/mcp-servers/session`)
        expect(res.status).toBe(200)
        const body = mcpSessionStateListSchema.parse(await res.json())
        expect(body.servers).toEqual([
            { name: 'linear', state: 'connected' },
            { name: 'notion', state: 'idle' },
            { name: 'down', state: 'idle' },
        ])
    })

    it('lists a failed server with its error class and no message', async () => {
        mocks.states = [{ name: 'down', state: 'failed', errorClass: 'unreachable' }]
        const res = await agentRoutes.request(`/${id}/mcp-servers/session`)
        const body = mcpSessionStateListSchema.parse(await res.json())
        expect(body.servers.find(server => server.name === 'down')).toEqual({ name: 'down', state: 'failed', errorClass: 'unreachable' })
    })
})

describe('POST /agents/:id/mcp-servers/:name/reconnect', () => {
    it('reconnect drops the pooled connection and answers reconnected true with effect next_call', async () => {
        mocks.held.add('linear')
        const res = await post('linear')
        expect(res.status).toBe(200)
        expect(mcpReconnectResultSchema.parse(await res.json())).toEqual({ name: 'linear', reconnected: true, effect: 'next_call', announced: 0 })
        expect(mocks.dropped).toEqual(['linear'])
    })

    it('reconnect on a server the pool does not hold answers reconnected false', async () => {
        const res = await post('notion')
        expect(mcpReconnectResultSchema.parse(await res.json())).toMatchObject({ name: 'notion', reconnected: false })
    })

    it('reconnect announces a data-mcp-reconnect part to the live runs and answers how many', async () => {
        mocks.live = 2
        const res = await post('linear')
        expect(mcpReconnectResultSchema.parse(await res.json()).announced).toBe(2)
        expect(mocks.announced).toHaveLength(1)
        const part = mocks.announced[0] as { type: string; data: unknown }
        expect(part.type).toBe('data-mcp-reconnect')
        expect(mcpReconnectEventSchema.parse(part.data)).toEqual({ name: 'linear', effect: 'next_call' })
    })

    it('reconnect answers effect next_message for a coworker on codex', async () => {
        mocks.provider = 'codex'
        const res = await post('linear')
        expect(mcpReconnectResultSchema.parse(await res.json()).effect).toBe('next_message')
        expect((mocks.announced[0] as { data: { effect: string } }).data.effect).toBe('next_message')
    })

    it('answers 404 for an unknown agent and for an unknown server, 400 for rerun', async () => {
        const unknownAgent = await post('linear', 'noagenthere')
        expect(unknownAgent.status).toBe(404)
        expect(await unknownAgent.json()).toEqual({ error: 'agent not found' })
        const unknownServer = await post('ghost')
        expect(unknownServer.status).toBe(404)
        expect(await unknownServer.json()).toEqual({ error: 'server not found' })
        expect((await post('rerun')).status).toBe(400)
        expect(mocks.dropped).toEqual([])
    })
})
