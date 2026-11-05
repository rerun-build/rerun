import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-datadir-checks-'))
process.env.RERUN_API_KEY = 'secret'

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm, writeFile } = await import('node:fs/promises')
const { createClient } = await import('@libsql/client')
const { agentDir, agentsDir, configPath, connectionConfigPath, dataVersionPath, sharedDbDir, sharedDbPath, systemDbPath, agentDataDir } = await import('../config/paths.js')
const { raw } = await import('../db/client.js')
const { insertAgentIndex } = await import('../db/repos/agents.js')
const { getSystemDb, closeSystemDb } = await import('../db/systemDb.js')
const { prepareDataDir } = await import('./ladder.js')
const { runDataDirChecks } = await import('./checks.js')
const { createServer } = await import('../http/server.js')

async function seedAgent(id: string, { indexed = true } = {}) {
    await mkdir(agentDir(id), { recursive: true })
    await writeFile(configPath(id), JSON.stringify({ name: id }), 'utf8')
    if (indexed) await insertAgentIndex(id, id)
}

function failing(report: Awaited<ReturnType<typeof runDataDirChecks>>) {
    return report.checks.filter(c => !c.ok).map(c => c.name)
}

beforeEach(async () => {
    closeSystemDb('alpha')
    await rm(agentsDir(), { recursive: true, force: true })
    await prepareDataDir()
    await raw().execute('DELETE FROM agents')
})

describe('runDataDirChecks', () => {
    it('passes on a migrated data-dir', async () => {
        await seedAgent('alpha')
        await getSystemDb('alpha')

        const report = await runDataDirChecks()

        expect(failing(report)).toEqual([])
        expect(report).toMatchObject({ ok: true, dataVersion: 4, dataVersionTarget: 4, agentIds: ['alpha'] })
    })

    it('flags a data-dir the ladder has not reached', async () => {
        await rm(dataVersionPath())
        const report = await runDataDirChecks()
        expect(report.ok).toBe(false)
        expect(failing(report)).toEqual(['data-version'])
    })

    it('flags an agent folder and the index disagreeing', async () => {
        await seedAgent('alpha', { indexed: false })
        await insertAgentIndex('ghost', 'ghost')
        const check = (await runDataDirChecks()).checks.find(c => c.name === 'agents-on-disk')
        expect(check?.ok).toBe(false)
        expect(check?.detail).toContain('indexed without a folder: ghost')
        expect(check?.detail).toContain('folder without an index row: alpha')
    })

    it('flags a config.json this build cannot read', async () => {
        await seedAgent('alpha')
        await writeFile(configPath('alpha'), '{ not json', 'utf8')
        expect(failing(await runDataDirChecks())).toEqual(['agents-on-disk'])
    })

    it('flags a system.db the ladder has not reached, without migrating it', async () => {
        await seedAgent('alpha')
        await mkdir(agentDataDir('alpha'), { recursive: true })
        const client = createClient({ url: `file:${systemDbPath('alpha')}` })
        await client.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
        client.close()

        expect(failing(await runDataDirChecks())).toEqual(['system-db'])
        expect(failing(await runDataDirChecks())).toEqual(['system-db'])
    })

    it('flags a shared database the ladder has not reached', async () => {
        await mkdir(sharedDbDir(), { recursive: true })
        const client = createClient({ url: `file:${sharedDbPath()}` })
        await client.execute('CREATE TABLE leads (id TEXT PRIMARY KEY)')
        client.close()

        const check = (await runDataDirChecks()).checks.find(c => c.name === 'shared-db')
        expect(check).toEqual({ name: 'shared-db', ok: false, detail: 'at v0, expected v1' })
        await rm(sharedDbDir(), { recursive: true, force: true })
    })

    it('flags a connection this build cannot read', async () => {
        await writeFile(connectionConfigPath('rerun'), '{ not json', 'utf8')
        const check = (await runDataDirChecks()).checks.find(c => c.name === 'connections')
        expect(check).toMatchObject({ ok: false, detail: 'unreadable: rerun' })
        await rm(connectionConfigPath('rerun'))
    })
})

describe('GET /doctor', () => {
    const app = createServer()

    it('needs the API key', async () => {
        expect((await app.request('/doctor')).status).toBe(401)
    })

    it('returns the report', async () => {
        const res = await app.request('/doctor', { headers: { Authorization: 'Bearer secret' } })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ ok: true, dataVersion: 4 })
    })
})
