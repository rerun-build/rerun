import { existsSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { FOREMAN_AGENT_ID, RERUN_CONNECTION_ID, type EngineDoctor, type EngineDoctorCheck } from '@rerun/contracts'
import { dbPath, sharedDbPath, systemDbPath } from '../config/paths.js'
import { listAgentIndex } from '../db/repos/agents.js'
import { sqliteVersion } from '../db/ladder.js'
import { SYSTEM_DB_VERSION, systemDbExists } from '../db/systemDb.js'
import { SHARED_DB_VERSION, sharedDbExists } from '../db/sharedDb.js'
import { listAgentIdsOnDisk, readAgentConfig } from '../agents/loader.js'
import { connectionExists, listConnectionIds, loadConnectionFromDisk } from '../connections/loader.js'
import { DATA_DIR_VERSION } from './migrations.js'
import { readDataVersion } from './version.js'
import { listVaultItems } from '../vault/store.js'
import { readAdopted } from '../vault/adopted.js'
import { adoptionSkipReason, heldAlready, readOwnRegistryEntries } from '../vault/adopt.js'

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

// Its own short-lived client rather than the engine's pooled one, which would migrate the file on
// open and hide exactly what this is here to see.
async function fileVersion(path: string): Promise<number> {
    const client = createClient({ url: `file:${path}` })
    try {
        return await sqliteVersion(client)
    } finally {
        client.close()
    }
}

/**
 * Whether the data-dir is in a state this build can run on. Strictly read-only: a diagnosis that
 * migrated as it went would repair the very thing it is meant to report.
 */
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
        // Informative only: a restore is refused on any failed check, and neither a stale id nor a
        // connector waiting for the next boot keeps a coworker from running.
        await check('vault', async () => {
            const items = await listVaultItems()
            const onDisk = new Set(await listAgentIdsOnDisk())
            const stale = [...new Set(items.flatMap(item => item.config.agentIds.filter(id => !onDisk.has(id))))]
            const adopted = readAdopted()
            const waiting: string[] = []
            for (const id of onDisk) {
                const entries = await readOwnRegistryEntries(id)
                for (const [key, entry] of Object.entries(entries)) {
                    if (adoptionSkipReason(entry) || adopted.agents[id]?.[key]) continue
                    if (!heldAlready(items, id, key)) waiting.push(`${id}:${key}`)
                }
            }
            return [`${items.length} item(s)`, ...(stale.length ? [`attached to coworkers gone: ${stale.join(', ')}`] : []), ...(waiting.length ? [`not in the Vault yet: ${waiting.join(', ')}`] : [])].join('; ')
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
