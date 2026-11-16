import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-tools-size-'))
process.env.RERUN_API_KEY = ''

vi.mock('../../config/env.js', async importOriginal => ({ ...(await importOriginal<typeof import('../../config/env.js')>()), desktopEnabled: () => false }))
vi.mock('../../paid-data/price.js', () => ({ paidDataOfferedSoFar: () => false }))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { agentRoutes } = await import('./agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { loadAgentFromDisk } = await import('../../agents/loader.js')
const { buildSystemPrompt, systemPromptText } = await import('../../agents/systemPrompt.js')

const id = 'sizeagent'

type Tool = { name: string; description: string; tokens?: number }
type Family = { family: string; enabled: boolean; tokens?: number; tools: Tool[] }
type Body = { families: Family[]; promptTokens?: number }

beforeEach(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'size' }))
})

async function read(): Promise<Body> {
    const res = await agentRoutes.request(`/${id}/tools`)
    expect(res.status).toBe(200)
    return (await res.json()) as Body
}

describe('GET /agents/:id/tools with sizes', () => {
    it('gives every built-in tool its size in tokens', async () => {
        const body = await read()
        const shell = body.families.find(f => f.family === 'shell')!
        expect(shell.tools).toEqual([expect.objectContaining({ name: 'shell_exec', tokens: 162 })])
        const shared = body.families.find(f => f.family === 'shared')!
        expect(shared.tools.map(t => [t.name, t.tokens])).toEqual([['shared_read', 126], ['shared_write', 91], ['shared_list', 70], ['shared_edit', 139], ['shared_search', 144]])
    })

    it('gives every family the sum of its tools', async () => {
        const body = await read()
        expect(body.families.find(f => f.family === 'shell')!.tokens).toBe(162)
        expect(body.families.find(f => f.family === 'shared')!.tokens).toBe(570)
        expect(body.families.find(f => f.family === 'quickReplies')!.tokens).toBe(0)
        for (const family of body.families) expect(family.tokens, family.family).toBe(family.tools.reduce((sum, t) => sum + (t.tokens ?? -1), 0))
    })

    it('gives the size of the coworker instructions and fixed sections', async () => {
        const body = await read()
        const expected = Math.ceil(systemPromptText(await buildSystemPrompt(await loadAgentFromDisk(id))).length / 4)
        expect(body.promptTokens).toBeGreaterThan(0)
        expect(Math.abs((body.promptTokens ?? 0) - expected)).toBeLessThanOrEqual(5)
    })
})
