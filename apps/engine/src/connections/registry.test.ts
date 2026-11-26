import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-registry-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm, writeFile } = await import('node:fs/promises')
const { agentDir, connectionConfigPath, connectionDir, connectionEnvPath, connectionsDir } = await import('../config/paths.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { activeAgentCount, getAgent } = await import('../agents/registry.js')
const { findConnection, getConnection, listConnections, reloadConnection, unloadConnection } = await import('./registry.js')

async function connection(id: string, env = '') {
    await mkdir(connectionDir(id), { recursive: true })
    await writeFile(connectionConfigPath(id), JSON.stringify({ name: id, provider: 'anthropic', models: ['m'], createdAt: '2026-01-01' }))
    await writeFile(connectionEnvPath(id), env)
}

beforeEach(async () => {
    for (const id of ['a', 'b']) unloadConnection(id)
    await rm(connectionsDir(), { recursive: true, force: true })
})

describe('connection registry', () => {
    it('hands every caller the same instance until it is unloaded', async () => {
        await connection('a', 'ANTHROPIC_API_KEY=one')
        const first = await getConnection('a')
        expect(await getConnection('a')).toBe(first)
        expect(await findConnection('a')).toBe(first)

        await writeFile(connectionEnvPath('a'), 'ANTHROPIC_API_KEY=two')
        expect((await getConnection('a')).env.ANTHROPIC_API_KEY).toBe('one')

        const reloaded = await reloadConnection('a')
        expect(reloaded).not.toBe(first)
        expect(reloaded.env.ANTHROPIC_API_KEY).toBe('two')
        expect(await getConnection('a')).toBe(reloaded)
    })

    it('404s on a connection that does not exist', async () => {
        await expect(getConnection('missing')).rejects.toMatchObject({ status: 404, message: 'connection not found' })
        await expect(reloadConnection('missing')).rejects.toMatchObject({ status: 404 })
    })

    it('finds nothing for a missing, null or empty id', async () => {
        expect(await findConnection(null)).toBeNull()
        expect(await findConnection(undefined)).toBeNull()
        expect(await findConnection('')).toBeNull()
        expect(await findConnection('missing')).toBeNull()
    })

    it('finds nothing for an id that could not name a connection folder, instead of refusing it', async () => {
        expect(await findConnection('openrouter/some-model')).toBeNull()
        expect(await findConnection('..')).toBeNull()
    })

    it('still serves a cached connection whose folder has gone, until unloaded', async () => {
        await connection('a')
        const cached = await getConnection('a')
        await rm(connectionDir('a'), { recursive: true, force: true })
        expect(await getConnection('a')).toBe(cached)
        expect(await findConnection('a')).toBeNull()
        unloadConnection('a')
        await expect(getConnection('a')).rejects.toMatchObject({ status: 404 })
    })

    it('lists every connection on disk through the cache', async () => {
        await connection('a')
        await connection('b')
        const a = await getConnection('a')
        const all = await listConnections()
        expect(all.map(c => c.id).sort()).toEqual(['a', 'b'])
        expect(all.find(c => c.id === 'a')).toBe(a)
    })

    it('leaves out a connection it cannot read, for a provider a newer engine knows, instead of failing the list', async () => {
        await connection('a')
        await mkdir(connectionDir('b'), { recursive: true })
        await writeFile(connectionConfigPath('b'), JSON.stringify({ name: 'b', provider: 'from-the-future', models: [], createdAt: '2026-01-01' }))
        await writeFile(connectionEnvPath('b'), '')

        expect((await listConnections()).map(c => c.id)).toEqual(['a'])
        expect(await findConnection('b')).toBeNull()
        await expect(getConnection('b')).rejects.toThrow()
    })

    it('drops every cached agent when a connection is unloaded', async () => {
        await mkdir(agentDir('holder'), { recursive: true })
        await writeAgentConfig('holder', agentConfigSchema.parse({ name: 'holder' }))
        const agent = await getAgent('holder')
        expect(activeAgentCount()).toBeGreaterThan(0)

        unloadConnection('a')

        expect(activeAgentCount()).toBe(0)
        expect(await getAgent('holder')).not.toBe(agent)
    })
})
