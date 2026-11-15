import type { Client } from '@libsql/client'
import { logger } from '../lib/logger.js'

export type SqliteMigration = { version: number; id: string; up: (client: Client) => Promise<void> }

export const latestVersion = (steps: { version: number }[]): number => steps.at(-1)?.version ?? 0

export async function sqliteVersion(client: Client): Promise<number> {
    const rs = await client.execute('PRAGMA user_version')
    return Number(rs.rows[0]?.user_version ?? 0)
}

export async function migrateSqlite(client: Client, steps: SqliteMigration[], file: string): Promise<void> {
    const current = await sqliteVersion(client)
    const target = latestVersion(steps)
    if (current > target) {
        logger.warn({ file, current, target }, 'sqlite file is newer than this engine, leaving it as is')
        return
    }
    for (const step of steps) {
        if (step.version <= current) continue
        await step.up(client)
        await client.execute(`PRAGMA user_version = ${step.version}`)
    }
}
