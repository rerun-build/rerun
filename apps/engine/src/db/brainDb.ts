import type { Client } from '@libsql/client'
import { brainDbDir, brainDbPath } from '../config/paths.js'
import { latestVersion, migrateSqlite, type SqliteMigration } from './ladder.js'
import { openStore } from './sqlStore.js'

const STORE_KEY = 'brain'

const BRAIN_DDL = `
CREATE TABLE IF NOT EXISTS brain_pages (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_chunks (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    heading TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    content TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    embedding F32_BLOB(1536)
);
CREATE INDEX IF NOT EXISTS brain_chunks_slug_idx ON brain_chunks(slug);
CREATE INDEX IF NOT EXISTS brain_chunks_vec_idx ON brain_chunks(libsql_vector_idx(embedding));

CREATE VIRTUAL TABLE IF NOT EXISTS brain_chunks_fts USING fts5(content, chunk_id UNINDEXED);

CREATE TABLE IF NOT EXISTS brain_links (
    from_slug TEXT NOT NULL,
    to_slug TEXT NOT NULL,
    PRIMARY KEY (from_slug, to_slug)
);
CREATE INDEX IF NOT EXISTS brain_links_to_idx ON brain_links(to_slug);

CREATE TABLE IF NOT EXISTS brain_proposals (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    mode TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    base_hash TEXT,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT
);
CREATE INDEX IF NOT EXISTS brain_proposals_status_idx ON brain_proposals(status);
CREATE INDEX IF NOT EXISTS brain_proposals_fingerprint_idx ON brain_proposals(fingerprint);

CREATE TABLE IF NOT EXISTS brain_revisions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    hash TEXT NOT NULL,
    author TEXT NOT NULL,
    proposal_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS brain_revisions_slug_idx ON brain_revisions(slug, created_at);
`

async function addColumn(client: Client, table: string, column: string, type: string): Promise<void> {
    const existing = await client.execute(`PRAGMA table_info('${table}')`)
    if (existing.rows.some(r => r.name === column)) return
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export const BRAIN_DB_MIGRATIONS: SqliteMigration[] = [
    {
        version: 1,
        id: 'baseline',
        up: async client => {
            await client.executeMultiple(BRAIN_DDL)
        },
    },
    {
        version: 2,
        id: 'proposal-headline',
        up: async client => {
            await addColumn(client, 'brain_proposals', 'headline', 'TEXT')
            await addColumn(client, 'brain_proposals', 'highlights_json', 'TEXT')
        },
    },
    {
        version: 3,
        id: 'proposal-dismiss-reason',
        up: async client => {
            await addColumn(client, 'brain_proposals', 'dismiss_reason', 'TEXT')
        },
    },
]

export const BRAIN_DB_VERSION = latestVersion(BRAIN_DB_MIGRATIONS)

let ready: Promise<Client> | null = null

export function getBrainDb(): Promise<Client> {
    if (!ready) {
        ready = openStore(STORE_KEY, brainDbPath(), brainDbDir())
            .then(async client => {
                await migrateSqlite(client, BRAIN_DB_MIGRATIONS, brainDbPath())
                return client
            })
            .catch(e => {
                ready = null
                throw e
            })
    }
    return ready
}
