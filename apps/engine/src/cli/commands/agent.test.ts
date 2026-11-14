import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cli-agent-'))
process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({
    events: [] as unknown[][],
    existing: new Set<string>(),
    index: [] as { id: string; status: string; name: string }[],
}))

vi.mock('../../datadir/ladder.js', () => ({ prepareDataDir: async () => void state.events.push(['prepareDataDir']) }))
vi.mock('../../agents/factory.js', () => ({
    createAgent: async (input: { config: { name: string } }) => {
        state.events.push(['createAgent', input])
        return { id: 'newid', config: { name: input.config.name } }
    },
}))
vi.mock('../../db/repos/agents.js', () => ({
    listAgentIndex: async () => state.index,
    deleteAgentIndex: async (id: string) => void state.events.push(['deleteAgentIndex', id]),
}))
vi.mock('../../agents/loader.js', () => ({ agentExists: (id: string) => state.existing.has(id) }))
vi.mock('../../agents/registry.js', () => ({ unloadAgent: (id: string) => void state.events.push(['unloadAgent', id]) }))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { existsSync } = await import('node:fs')
const { mkdir, writeFile } = await import('node:fs/promises')
const { agentDir } = await import('../../config/paths.js')
const { agentCommand } = await import('./agent.js')

let out = ''

function created() {
    return state.events.find(([name]) => name === 'createAgent')?.[1] as { config: Record<string, unknown>; keys: Record<string, string> }
}

beforeEach(() => {
    state.events = []
    state.existing = new Set()
    state.index = []
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        out += String(chunk)
        return true
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('rerun agent create', () => {
    it('creates an agent from its flags and reports it', async () => {
        await agentCommand(['create', '--name', 'Scout', '--provider', 'anthropic', '--model', 'claude-opus-4-8', '--key', 'ANTHROPIC_API_KEY=sk=with=equals'])

        expect(state.events.slice(0, 1)).toEqual([['prepareDataDir']])
        expect(created()).toEqual({ config: { name: 'Scout', provider: 'anthropic', model: 'claude-opus-4-8' }, keys: { ANTHROPIC_API_KEY: 'sk=with=equals' } })
        expect(out).toBe('Created agent newid (Scout)\n')
    })

    it('leaves the provider, model and keys unset when not given', async () => {
        await agentCommand(['create', '--name', 'Scout'])
        expect(created()).toEqual({ config: { name: 'Scout', provider: undefined, model: undefined }, keys: {} })
    })

    it('refuses a create without a name, after migrating', async () => {
        await expect(agentCommand(['create', '--model', 'x'])).rejects.toThrow('Usage: rerun agent create --name <name>')
        expect(state.events).toEqual([['prepareDataDir']])
    })

    it('mangles a --key given without an equals sign', async () => {
        await agentCommand(['create', '--name', 'Scout', '--key', 'FOO'])
        expect(created().keys).toEqual({ FO: 'FOO' })
    })

    it('reads a flag with no value as the string true', async () => {
        await agentCommand(['create', '--name', '--key', '--model'])
        expect(created()).toEqual({ config: { name: 'true', provider: undefined, model: 'true' }, keys: { tru: 'true' } })
    })

    it('keeps only the last of several --key flags', async () => {
        await agentCommand(['create', '--name', 'Scout', '--key', 'A=1', '--key', 'B=2'])
        expect(created().keys).toEqual({ B: '2' })
    })
})

describe('rerun agent list', () => {
    it('prints one tab-separated line per indexed agent', async () => {
        state.index = [
            { id: 'a1', status: 'idle', name: 'Scout' },
            { id: 'a2', status: 'busy', name: 'Writer' },
        ]
        await agentCommand(['list'])
        expect(out).toBe('a1\tidle\tScout\na2\tbusy\tWriter\n')
    })

    it('prints nothing for an empty box', async () => {
        await agentCommand(['list'])
        expect(out).toBe('')
    })
})

describe('rerun agent delete', () => {
    it('unloads, unindexes and removes the folder', async () => {
        state.existing.add('doomed')
        await mkdir(agentDir('doomed'), { recursive: true })
        await writeFile(resolve(agentDir('doomed'), 'config.json'), '{}')

        await agentCommand(['delete', 'doomed'])

        expect(state.events.slice(1)).toEqual([
            ['unloadAgent', 'doomed'],
            ['deleteAgentIndex', 'doomed'],
        ])
        expect(existsSync(agentDir('doomed'))).toBe(false)
        expect(out).toBe('Deleted doomed\n')
    })

    it('refuses a missing or unknown id', async () => {
        await expect(agentCommand(['delete'])).rejects.toThrow('Usage: rerun agent delete <id>')
        await expect(agentCommand(['delete', 'ghost'])).rejects.toThrow('Usage: rerun agent delete <id>')
        expect(state.events.some(([name]) => name === 'deleteAgentIndex')).toBe(false)
    })

    it('refuses to delete the foreman', async () => {
        state.existing.add('foreman')
        await expect(agentCommand(['delete', 'foreman'])).rejects.toThrow('The foreman is managed by the engine and cannot be deleted')
        expect(state.events.some(([name]) => name === 'unloadAgent')).toBe(false)
    })
})

describe('rerun agent', () => {
    it('prints the usage for an unknown or missing subcommand', async () => {
        await expect(agentCommand([])).rejects.toThrow('Usage: rerun agent <create|list|delete>')
        await expect(agentCommand(['rename'])).rejects.toThrow('Usage: rerun agent <create|list|delete>')
    })
})
