import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-agent-registry-'))
process.env.RERUN_API_KEY = ''

const { vi } = await import('vitest')
const released = vi.hoisted(() => [] as Array<{ agentId: string; keep?: string[] }>)
vi.mock('../tools/mcp-pool.js', () => ({ releaseAgentMcp: (agentId: string, keep?: string[]) => released.push({ agentId, keep }) }))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { agentDir } = await import('../config/paths.js')
const { writeAgentConfig } = await import('./config-write.js')
const { agentConfigSchema } = await import('./types.js')
const { activeAgentCount, clearAgentCache, getAgent, reloadAgent, unloadAgent } = await import('./registry.js')

async function agentOnDisk(id: string, name = id) {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name }))
}

beforeEach(() => {
    clearAgentCache()
    released.length = 0
})

describe('agent registry', () => {
    it('hands out one cached instance per agent', async () => {
        await agentOnDisk('one')
        const first = await getAgent('one')
        expect(await getAgent('one')).toBe(first)
        expect(activeAgentCount()).toBe(1)
    })

    it('404s on an agent with no config', async () => {
        await expect(getAgent('ghost')).rejects.toMatchObject({ status: 404, message: 'agent not found' })
        expect(activeAgentCount()).toBe(0)
    })

    it('rereads the disk after an unload or a reload', async () => {
        await agentOnDisk('two', 'Before')
        const before = await getAgent('two')

        await writeAgentConfig('two', agentConfigSchema.parse({ name: 'After' }))
        expect((await getAgent('two')).config.name).toBe('Before')

        const reloaded = await reloadAgent('two')
        expect(reloaded.config.name).toBe('After')
        expect(reloaded).not.toBe(before)

        unloadAgent('two')
        expect(activeAgentCount()).toBe(0)
        expect(await getAgent('two')).not.toBe(reloaded)
    })

    it('clears every agent at once', async () => {
        await agentOnDisk('a')
        await agentOnDisk('b')
        await getAgent('a')
        await getAgent('b')
        expect(activeAgentCount()).toBe(2)
        clearAgentCache()
        expect(activeAgentCount()).toBe(0)
    })

    it('closes the MCP connections of servers the agent dropped on reload, and all of them on unload', async () => {
        await mkdir(agentDir('mcp'), { recursive: true })
        await writeAgentConfig('mcp', agentConfigSchema.parse({ name: 'mcp', mcpServers: [{ name: 'gh', url: 'https://gh.example/mcp' }] }))
        await reloadAgent('mcp')
        unloadAgent('mcp')
        expect(released).toEqual([
            { agentId: 'mcp', keep: ['gh'] },
            { agentId: 'mcp', keep: undefined },
        ])
    })
})
