import { existsSync } from 'node:fs'
import type { Client } from '@libsql/client'
import { sharedDbDir, sharedDbPath } from '../config/paths.js'
import { formatSchema, listTables, openStore, type SchemaOptions } from './sqlStore.js'
import { latestVersion, migrateSqlite, type SqliteMigration } from './ladder.js'
import { VIEWS_TABLE, viewNamesByTable } from './tableViews.js'

const STORE_KEY = 'shared'
const META_TABLE = '_rerun_shared_tables'

export const SHARED_HIDDEN_TABLES = [META_TABLE, VIEWS_TABLE]

const META_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE} (table_name TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`

export const SHARED_DB_MIGRATIONS: SqliteMigration[] = [
    {
        version: 1,
        id: 'baseline',
        up: async client => {
            await client.execute(META_DDL)
        },
    },
]

export const SHARED_DB_VERSION = latestVersion(SHARED_DB_MIGRATIONS)

let ready: Promise<Client> | null = null

export function getSharedDb(): Promise<Client> {
    if (!ready) {
        ready = openStore(STORE_KEY, sharedDbPath(), sharedDbDir())
            .then(async client => {
                await migrateSqlite(client, SHARED_DB_MIGRATIONS, sharedDbPath())
                return client
            })
            .catch(e => {
                ready = null
                throw e
            })
    }
    return ready
}

export function sharedDbExists(): boolean {
    return existsSync(sharedDbPath())
}

function stripComments(sql: string): string {
    return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
}

const IDENT = String.raw`"(?:[^"]|"")*"|\x60[^\x60]*\x60|\[[^\]]*\]|[A-Za-z_][\w$]*`
const CREATE_TABLE = new RegExp(String.raw`\bcreate\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'gi')
const DROP_TABLE = new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${IDENT})`, 'gi')
const RENAME_TABLE = new RegExp(String.raw`\balter\s+table\s+(${IDENT})\s+rename\s+to\s+(${IDENT})`, 'gi')

function unquote(ident: string): string {
    if (ident.startsWith('"')) return ident.slice(1, -1).replace(/""/g, '"')
    if (ident.startsWith('`') || ident.startsWith('[')) return ident.slice(1, -1)
    return ident
}

function matches(re: RegExp, sql: string): string[][] {
    re.lastIndex = 0
    return [...sql.matchAll(re)].map(m => m.slice(1).map(unquote))
}

export async function recordTableOwnership(client: Client, statements: string[], agentName: string): Promise<void> {
    try {
        const now = new Date().toISOString()
        for (const raw of statements) {
            const sql = stripComments(raw)
            for (const [name] of matches(CREATE_TABLE, sql)) {
                if (name === META_TABLE) continue
                await client.execute({
                    sql: `INSERT INTO ${META_TABLE} (table_name, created_by, created_at) VALUES (?, ?, ?) ON CONFLICT(table_name) DO NOTHING`,
                    args: [name, agentName, now],
                })
            }
            for (const [name] of matches(DROP_TABLE, sql)) {
                await client.execute({ sql: `DELETE FROM ${META_TABLE} WHERE table_name = ?`, args: [name] })
            }
            for (const [from, to] of matches(RENAME_TABLE, sql)) {
                await client.execute({ sql: `UPDATE ${META_TABLE} SET table_name = ? WHERE table_name = ?`, args: [to, from] })
            }
        }
    } catch {}
}

export async function tableOwners(client: Client): Promise<Map<string, string>> {
    try {
        const rs = await client.execute(`SELECT table_name, created_by FROM ${META_TABLE}`)
        return new Map(rs.rows.map(r => [String(r.table_name), String(r.created_by)]))
    } catch {
        return new Map()
    }
}

export async function renameTableOwner(client: Client, fromAgentName: string, toAgentName: string): Promise<void> {
    await client.execute({ sql: `UPDATE ${META_TABLE} SET created_by = ? WHERE created_by = ?`, args: [toAgentName, fromAgentName] })
}

export async function readSharedDbSchema(options: SchemaOptions = {}): Promise<string> {
    if (!sharedDbExists()) return ''
    const client = await getSharedDb()
    const [tables, owners, views] = await Promise.all([listTables(client, SHARED_HIDDEN_TABLES), tableOwners(client), viewNamesByTable(client)])
    return formatSchema(tables, {
        ...options,
        annotate: name => {
            const owner = owners.get(name)
            const viewList = views.get(name)
            return `${owner ? ` created by ${owner}` : ''}${viewList?.length ? `; views: ${viewList.join(', ')}` : ''}`
        },
    })
}
