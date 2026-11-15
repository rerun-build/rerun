import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-tools-'))

type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> }

const mocks = vi.hoisted(() => ({ tools: new Map<string, Tool[]>(), failures: new Map<string, Error>(), closed: [] as string[] }))

vi.mock('../../tools/mcp.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../tools/mcp.js')>()),
    openMcpClient: async (server: { name: string }) => {
        const failure = mocks.failures.get(server.name)
        if (failure) throw failure
        return {
            client: { close: async () => void mocks.closed.push(server.name) },
            tools: mocks.tools.get(server.name) ?? [],
        }
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { agentRoutes } = await import('./agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')

const id = 'toolsagent'

const http = (name: string, tools?: string[]) => ({ name, transport: 'http', url: `https://${name}.example/mcp`, ...(tools ? { tools } : {}) })

const search: Tool = { name: 'search', description: 'Find symbols by name', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }
const edit: Tool = { name: 'edit', description: 'Change a file', inputSchema: { type: 'object', properties: {} } }

type Body = { name: string; picks: string[]; tools: { name: string; description: string; tokens: number; picked: boolean }[] }

beforeEach(async () => {
    mocks.tools.clear()
    mocks.failures.clear()
    mocks.closed.length = 0
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(
        id,
        agentConfigSchema.parse({ name: 'tools', mcpServers: [http('plain'), http('picky', ['search']), http('down'), http('rerun')] }),
    )
})

describe('GET /agents/:id/mcp-servers/:name/tools', () => {
    it('lists every tool the server serves with its size in tokens', async () => {
        mocks.tools.set('plain', [search, edit])
        const res = await agentRoutes.request(`/${id}/mcp-servers/plain/tools`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as Body
        expect(body.tools.map(t => t.name)).toEqual(['search', 'edit'])
        expect(body.tools[0]).toEqual({ name: 'search', description: 'Find symbols by name', tokens: 31, picked: true })
        expect(mocks.closed).toEqual(['plain'])
    })

    it('marks the picked tools, and all of them when nothing is picked', async () => {
        mocks.tools.set('plain', [search, edit])
        mocks.tools.set('picky', [search, edit])
        const plain = (await (await agentRoutes.request(`/${id}/mcp-servers/plain/tools`)).json()) as Body
        const picky = (await (await agentRoutes.request(`/${id}/mcp-servers/picky/tools`)).json()) as Body
        expect(plain.tools.map(t => t.picked)).toEqual([true, true])
        expect(picky.tools.map(t => t.picked)).toEqual([true, false])
    })

    it('still lists the unpicked tools of a server that has picks', async () => {
        mocks.tools.set('picky', [search, edit])
        const body = (await (await agentRoutes.request(`/${id}/mcp-servers/picky/tools`)).json()) as Body
        expect(body.tools.map(t => t.name)).toEqual(['search', 'edit'])
    })

    it('answers 404 for an unknown agent or server, 400 for rerun, and 502 with an error class for an unreachable server', async () => {
        expect((await agentRoutes.request('/nobody/mcp-servers/plain/tools')).status).toBe(404)
        expect((await agentRoutes.request(`/${id}/mcp-servers/ghost/tools`)).status).toBe(404)
        expect((await agentRoutes.request(`/${id}/mcp-servers/rerun/tools`)).status).toBe(400)
        mocks.failures.set('down', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }))
        const res = await agentRoutes.request(`/${id}/mcp-servers/down/tools`)
        expect(res.status).toBe(502)
        expect(await res.json()).toEqual({ error: 'unreachable' })
    })

    it('answers the stored picks unchanged', async () => {
        mocks.tools.set('picky', [search])
        mocks.tools.set('plain', [search])
        const picky = (await (await agentRoutes.request(`/${id}/mcp-servers/picky/tools`)).json()) as Body
        const plain = (await (await agentRoutes.request(`/${id}/mcp-servers/plain/tools`)).json()) as Body
        expect(picky.picks).toEqual(['search'])
        expect(plain.picks).toEqual([])
    })
})
