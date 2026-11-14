import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-verbosity-'))

const { describe, expect, it, beforeEach } = await import('vitest')
const { selfTools } = await import('./self.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir, configPath } = await import('../../config/paths.js')
const { mkdir, readFile } = await import('node:fs/promises')

const id = 'verbosityagent'

function ctxWith(selfImprovement: Record<string, boolean>) {
    return { agent: { id, config: agentConfigSchema.parse({ name: 'verbosity', selfImprovement }) } } as any
}

async function readVerbosity(): Promise<string> {
    return agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8'))).verbosity
}

beforeEach(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'verbosity', description: 'A configured agent', provider: 'openrouter', model: 'acme/router-large' }))
})

describe('verbosity_set', () => {
    it('persists the new level without touching the rest of the config', async () => {
        const tools = selfTools(ctxWith({ enabled: true }))
        const message = (await (tools.verbosity_set as any).execute({ level: 'minimal', reason: 'The user asked for shorter answers.' }, {} as any)) as string
        expect(message).toContain('minimal')
        expect(await readVerbosity()).toBe('minimal')

        const config = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
        expect(config.model).toBe('acme/router-large')
        expect(config.description).toBe('A configured agent')
    })

    it('is offered even when soul edits and tool installs are both off', async () => {
        const tools = selfTools(ctxWith({ enabled: true, allowSoulEdit: false, allowToolInstall: false }))
        expect(tools.verbosity_set).toBeDefined()
        expect(tools.soul_update).toBeUndefined()
        expect(tools.tool_install).toBeUndefined()
    })
})
