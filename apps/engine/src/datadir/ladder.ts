import { latestVersion } from '../db/ladder.js'
import { ensureAgentsIndex } from '../db/migrate.js'
import { reconcileConnections } from '../connections/migrate.js'
import { logger } from '../lib/logger.js'
import { DATA_DIR_MIGRATIONS, type DataDirMigration } from './migrations.js'
import { readDataVersion, writeDataVersion } from './version.js'

export async function migrateDataDir(steps: DataDirMigration[] = DATA_DIR_MIGRATIONS): Promise<void> {
    const current = readDataVersion()
    const target = latestVersion(steps)
    if (current > target) {
        logger.warn({ current, target }, 'data-dir is newer than this engine, leaving it as is')
        return
    }
    for (const step of steps) {
        if (step.version <= current) continue
        await step.up()
        await writeDataVersion(step.version)
        logger.info({ step: step.id, version: step.version }, 'data-dir migrated')
    }
}

export async function prepareDataDir(): Promise<void> {
    await migrateDataDir()
    await ensureAgentsIndex()
    await reconcileConnections()
}
