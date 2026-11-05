import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { McpServer } from '@rerun/contracts'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cw-'))

const { describe, expect, it } = await import('vitest')
const { mergeMcpServers, writeAgentConfig } = await import('./config-write.js')
const { agentConfigSchema, BRIDGE_SERVER_NAME } = await import('./types.js')
const { chmod, mkdir, readFile, stat } = await import('node:fs/promises')
const { agentDir, configPath } = await import('../config/paths.js')

const srv = (name: string, url = `http://${name}`): McpServer => ({ name, transport: 'http', url, args: [], env: {}, headers: {} })

describe('mergeMcpServers', () => {
    it('appends a new server', () => {
        expect(mergeMcpServers([srv('a')], { upsert: [srv('b')] }).map(s => s.name)).toEqual(['a', 'b'])
    })

    it('replaces a same-name server in place', () => {
        const merged = mergeMcpServers([srv('a', 'http://old')], { upsert: [srv('a', 'http://new')] })
        expect(merged).toHaveLength(1)
        expect(merged[0].url).toBe('http://new')
    })

    it('removes by name', () => {
        expect(mergeMcpServers([srv('a'), srv('b')], { remove: ['a'] }).map(s => s.name)).toEqual(['b'])
    })

    it('handles a rename (remove old + upsert new) in one call', () => {
        const merged = mergeMcpServers([srv('a'), srv('b')], { remove: ['a'], upsert: [srv('c')] })
        expect(merged.map(s => s.name)).toEqual(['b', 'c'])
    })

    it('refuses the name the builtin tool bridge takes, which a provider would silently drop', () => {
        expect(() => mergeMcpServers([], { upsert: [srv(BRIDGE_SERVER_NAME)] })).toThrow(/reserved/)
    })

    it('still removes a reserved-name server registered before the guard existed', () => {
        expect(mergeMcpServers([srv(BRIDGE_SERVER_NAME), srv('b')], { remove: [BRIDGE_SERVER_NAME] }).map(s => s.name)).toEqual(['b'])
    })

    it('applies remove before upsert so re-adding a removed name keeps the upsert', () => {
        const merged = mergeMcpServers([srv('a', 'http://old')], { remove: ['a'], upsert: [srv('a', 'http://new')] })
        expect(merged).toHaveLength(1)
        expect(merged[0].url).toBe('http://new')
    })

    it('refuses a name a CLI provider would reject at settings validation', () => {
        expect(() => mergeMcpServers([], { upsert: [srv('logo.dev')] })).toThrow(/invalid/)
    })

    it('refuses a name longer than 64 characters', () => {
        expect(() => mergeMcpServers([], { upsert: [srv('a'.repeat(65))] })).toThrow(/invalid/)
    })

    it('still loads and removes an invalid legacy name already in the config', () => {
        expect(mergeMcpServers([srv('logo.dev'), srv('b')], { remove: ['logo.dev'] }).map(s => s.name)).toEqual(['b'])
    })
})

describe('agentConfigSchema', () => {
    // Agents predate every field added since they were created; a config.json written before one
    // exists must still load, or loadAgentFromDisk throws and the agent disappears from the API.
    it('reads a config.json written before box connections existed', () => {
        const legacy = { name: 'legacy', description: '', provider: 'openrouter', model: 'anthropic/claude-opus-4.8', temperature: 0.7, tools: {}, mcpServers: [], selfImprovement: {} }
        const parsed = agentConfigSchema.parse(legacy)
        expect(parsed.connectionId).toBeNull()
        expect(parsed.provider).toBe('openrouter')
    })
})

describe('writeAgentConfig', () => {
    it('writes config.json that parses back to the same config', async () => {
        const id = 'cwagent'
        await mkdir(agentDir(id), { recursive: true })
        const config = agentConfigSchema.parse({ name: 'cw', mcpServers: [srv('a')] })
        await writeAgentConfig(id, config)
        const roundTripped = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
        expect(roundTripped.mcpServers.map(s => s.name)).toEqual(['a'])
    })

    it('writes config.json readable by the engine alone, and narrows one left wider', async () => {
        const id = 'cwmodes'
        const mode = async () => (await stat(configPath(id))).mode & 0o777
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'modes' }))
        expect(await mode()).toBe(0o600)
        await chmod(configPath(id), 0o644)
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'modes again' }))
        expect(await mode()).toBe(0o600)
    })
})
