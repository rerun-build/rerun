import { existsSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { FOREMAN_AGENT_ID, RERUN_CONNECTION_ID, type EngineDoctor, type EngineDoctorCheck } from '@moldwright/contracts'
import { dbPath, sharedDbPath, systemDbPath } from '../config/paths.js'
import { listAgentIndex } from '../db/repos/agents.js'
import { sqliteVersion } from '../db/ladder.js'
import { SYSTEM_DB_VERSION, systemDbExists } from '../db/systemDb.js'
import { SHARED_DB_VERSION, sharedDbExists } from '../db/sharedDb.js'
import { listAgentIdsOnDisk, readAgentConfig } from '../agents/loader.js'
import { connectionExists, listConnectionIds, loadConnectionFromDisk } from '../connections/loader.js'
import { DATA_DIR_VERSION } from './migrations.js'
import { readDataVersion } from './version.js'

async function check(name: string, run: () => Promise<string | undefined>): Promise<EngineDoctorCheck> {
    try {
        const detail = await run()
        return detail ? { name, ok: true, detail } : { name, ok: true }
    } catch (err) {
        return { name, ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
}

function failIf(problems: string[]): void {
    if (problems.length > 0) throw new Error(problems.join('; '))
}

async function fileVersion(path: string): Promise<number> {
    const client = createClient({ url: `file:${path}` })
    try {
        return await sqliteVersion(client)
    } finally {
        client.close()
    }
}

export async function runDataDirChecks(): Promise<EngineDoctor> {
    const dataVersion = readDataVersion()
    let agentIds: string[] = []

    const checks = [
        await check('data-version', async () => {
            failIf(dataVersion === DATA_DIR_VERSION ? [] : [`data-dir at v${dataVersion}, this engine expects v${DATA_DIR_VERSION}`])
            return `v${dataVersion}`
        }),
        await check('index', async () => {
            failIf(existsSync(dbPath()) ? [] : ['rerun.db is missing'])
            agentIds = (await listAgentIndex()).map(row => row.id)
            return `${agentIds.length} agent(s)`
        }),
        await check('agents-on-disk', async () => {
            const onDisk = (await listAgentIdsOnDisk()).filter(id => id !== FOREMAN_AGENT_ID)
            const missing = agentIds.filter(id => !onDisk.includes(id))
            const unindexed = onDisk.filter(id => !agentIds.includes(id))
            const unreadable: string[] = []
            for (const id of agentIds.filter(id => onDisk.includes(id))) {
                await readAgentConfig(id).catch(() => unreadable.push(id))
            }
            failIf([...(missing.length ? [`indexed without a folder: ${missing.join(', ')}`] : []), ...(unindexed.length ? [`folder without an index row: ${unindexed.join(', ')}`] : []), ...(unreadable.length ? [`unreadable config.json: ${unreadable.join(', ')}`] : [])])
            return undefined
        }),
        await check('system-db', async () => {
            const behind: string[] = []
            for (const id of agentIds.filter(systemDbExists)) {
                const version = await fileVersion(systemDbPath(id))
                if (version !== SYSTEM_DB_VERSION) behind.push(`${id} at v${version}`)
            }
            failIf(behind.length ? [`expected v${SYSTEM_DB_VERSION}: ${behind.join(', ')}`] : [])
            return undefined
        }),
        await check('connections', async () => {
            const ids = await listConnectionIds()
            const unreadable: string[] = []
            for (const id of ids) await loadConnectionFromDisk(id).catch(() => unreadable.push(id))
            failIf([...(connectionExists(RERUN_CONNECTION_ID) ? [] : ['the Rerun connection is missing']), ...(unreadable.length ? [`unreadable: ${unreadable.join(', ')}`] : [])])
            return `${ids.length} connection(s)`
        }),
        await check('shared-db', async () => {
            if (!sharedDbExists()) return 'not created yet'
            const version = await fileVersion(sharedDbPath())
            failIf(version === SHARED_DB_VERSION ? [] : [`at v${version}, expected v${SHARED_DB_VERSION}`])
            return undefined
        }),
    ]

    return { ok: checks.every(c => c.ok), dataVersion, dataVersionTarget: DATA_DIR_VERSION, agentIds, checks }
}
