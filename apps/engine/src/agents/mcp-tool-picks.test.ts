import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-picks-'))

const { describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { mcpServerSchema } = await import('@moldwright/contracts')
const { agentRoutes } = await import('../http/routes/agents.js')
const { agentConfigSchema } = await import('./types.js')
const { writeAgentConfig } = await import('./config-write.js')
const { readAgentConfig } = await import('./loader.js')
const { agentDir } = await import('../config/paths.js')

const entry = (extra: Record<string, unknown> = {}) => ({ name: 'linear', transport: 'http', url: 'https://linear.example/mcp', ...extra })

describe('mcp server tool picks', () => {
    it('keeps a list of picked tool names on a server entry', () => {
        expect(mcpServerSchema.parse(entry({ tools: ['a', 'b'] })).tools).toEqual(['a', 'b'])
    })

    it('parses an entry without tools to an object without a tools key', () => {
        const parsed = mcpServerSchema.parse(entry())
        expect('tools' in parsed).toBe(false)
    })

    it('refuses an empty tool name, a name of 129 characters and a list of 201 names, and accepts 128 and 200', () => {
        expect(mcpServerSchema.safeParse(entry({ tools: [''] })).success).toBe(false)
        expect(mcpServerSchema.safeParse(entry({ tools: ['x'.repeat(129)] })).success).toBe(false)
        expect(mcpServerSchema.safeParse(entry({ tools: Array.from({ length: 201 }, (_, i) => `t${i}`) })).success).toBe(false)
        expect(mcpServerSchema.safeParse(entry({ tools: ['x'.repeat(128)] })).success).toBe(true)
        expect(mcpServerSchema.safeParse(entry({ tools: Array.from({ length: 200 }, (_, i) => `t${i}`) })).success).toBe(true)
    })

    it('refuses a tools value that is not a list of strings', () => {
        expect(mcpServerSchema.safeParse(entry({ tools: 'a' })).success).toBe(false)
        expect(mcpServerSchema.safeParse(entry({ tools: [1] })).success).toBe(false)
    })

    it('writes and reads the picks through writeAgentConfig and readAgentConfig', async () => {
        const id = 'picksagent'
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'picks', mcpServers: [entry({ tools: ['a', 'b'] })] }))
        const read = await readAgentConfig(id)
        expect(read.mcpServers[0]?.tools).toEqual(['a', 'b'])
    })

    it('keeps the picks through PATCH /agents/:id/mcp-servers', async () => {
        const id = 'patchpicks'
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'patch' }))
        const res = await agentRoutes.request(`/${id}/mcp-servers`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ upsert: [entry({ tools: ['a', 'b'] })] }),
        })
        expect(res.status).toBe(200)
        const detail = (await (await agentRoutes.request(`/${id}`)).json()) as { config: { mcpServers: { tools?: string[] }[] } }
        expect(detail.config.mcpServers[0]?.tools).toEqual(['a', 'b'])
    })
})
