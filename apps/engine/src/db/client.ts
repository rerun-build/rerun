import { mkdirSync } from 'node:fs'
import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { dataDir, dbPath } from '../config/paths.js'
import { agents } from './schema.js'

const schema = { agents }

let client: Client | null = null
let database: LibSQLDatabase<typeof schema> | null = null

function init() {
    mkdirSync(dataDir(), { recursive: true })
    client = createClient({ url: `file:${dbPath()}`, timeout: 5000 })
    void client.execute('PRAGMA journal_mode = WAL').catch(() => {})
    database = drizzle(client, { schema })
}

export function raw(): Client {
    if (!client) init()
    return client!
}

export function db(): LibSQLDatabase<typeof schema> {
    if (!database) init()
    return database!
}
