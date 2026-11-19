import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-agents-'))

const { describe, expect, it, beforeEach } = await import('vitest')
const { agentRoutes } = await import('./agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir } = await import('../../config/paths.js')

const id = 'raceagent'

async function seedAgent() {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'race' }))
}

function patchMcp(body: unknown) {
    return agentRoutes.request(`/${id}/mcp-servers`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
}

async function currentServerNames(): Promise<string[]> {
    const res = await agentRoutes.request(`/${id}`)
    const detail = (await res.json()) as { config: { mcpServers: { name: string }[] } }
    return detail.config.mcpServers.map(s => s.name)
}

describe('PATCH /agents/:id/mcp-servers under concurrency', () => {
    beforeEach(seedAgent)

    it('keeps every server when many upserts hit the same agent at once', async () => {
        const N = 20
        const server = (i: number) => ({ name: `srv-${i}`, transport: 'http', url: `http://s${i}`, args: [], env: {}, headers: {} })
        await Promise.all(Array.from({ length: N }, (_, i) => patchMcp({ upsert: [server(i)] })))
        const names = await currentServerNames()
        expect(names).toHaveLength(N)
        for (let i = 0; i < N; i++) expect(names).toContain(`srv-${i}`)
    })

    it('rejects the reserved bridge name instead of saving a server no provider will load', async () => {
        const res = await patchMcp({ upsert: [{ name: 'rerun', transport: 'http', url: 'https://moldwright.robagentic.tech/api/mcp/account', args: [], env: {}, headers: {} }] })
        expect(res.status).toBe(400)
        expect(await currentServerNames()).not.toContain('rerun')
    })

    it('rejects setting mcpServers via PATCH /:id', async () => {
        const res = await agentRoutes.request(`/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mcpServers: [] }),
        })
        expect(res.status).toBe(400)
    })
})

describe('GET /agents/:id/keys', () => {
    beforeEach(seedAgent)

    it('reports non-empty RERUN_* process env names as engineKeys, separate from the agent env', async () => {
        process.env.RERUN_TEST_MARKER = 'from-process'
        process.env.RERUN_TEST_EMPTY = ''
        await agentRoutes.request(`/${id}/keys`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ set: { AGENT_ONLY: 'v' } }),
        })
        const res = await agentRoutes.request(`/${id}/keys`)
        const { keys, engineKeys } = (await res.json()) as { keys: string[]; engineKeys: string[] }
        expect(keys).toEqual(['AGENT_ONLY'])
        expect(engineKeys).toContain('RERUN_TEST_MARKER')
        expect(engineKeys).not.toContain('RERUN_TEST_EMPTY')
        expect(engineKeys).not.toContain('PATH')
        expect(engineKeys).not.toContain('AGENT_ONLY')
    })
})

describe('PATCH /agents/:id/keys under concurrency', () => {
    beforeEach(seedAgent)

    it('keeps every key when many concurrent set calls hit the same agent', async () => {
        const N = 20
        await Promise.all(
            Array.from({ length: N }, (_, i) =>
                agentRoutes.request(`/${id}/keys`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ set: { [`K${i}`]: `v${i}` } }),
                }),
            ),
        )
        const res = await agentRoutes.request(`/${id}/keys`)
        const { keys } = (await res.json()) as { keys: string[] }
        for (let i = 0; i < N; i++) expect(keys).toContain(`K${i}`)
    })
})
