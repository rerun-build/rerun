import { getBrainDb } from '../db/brainDb.js'
import { embedText } from '../memory/embed.js'
import { logger } from '../lib/logger.js'
import { chunkText } from './chunks.js'

const PASS_LIMIT = 500
const MAX_CONSECUTIVE_FAILURES = 3

let running: Promise<number> | null = null
let rerun = false

async function embedPass(): Promise<{ embedded: number; hubDown: boolean }> {
    const client = await getBrainDb()
    const rs = await client.execute({
        sql: `SELECT c.id, c.text_hash, c.heading, c.content, p.title, p.type
              FROM brain_chunks c JOIN brain_pages p ON p.slug = c.slug
              WHERE c.embedding IS NULL ORDER BY c.slug, c.ordinal LIMIT ?`,
        args: [PASS_LIMIT],
    })
    let embedded = 0
    let failures = 0
    for (const row of rs.rows) {
        const vector = await embedText(chunkText(String(row.title), String(row.type), String(row.heading), String(row.content))).catch(() => null)
        if (!vector) {
            if (++failures >= MAX_CONSECUTIVE_FAILURES) return { embedded, hubDown: true }
            continue
        }
        failures = 0
        const updated = await client.execute({
            sql: 'UPDATE brain_chunks SET embedding = vector32(?) WHERE id = ? AND text_hash = ?',
            args: [`[${vector.join(',')}]`, String(row.id), String(row.text_hash)],
        })
        embedded += updated.rowsAffected
    }
    return { embedded, hubDown: false }
}

export function embedPendingChunks(): Promise<number> {
    if (running) {
        rerun = true
        return running
    }
    running = (async () => {
        let total = 0
        let hubDown = false
        do {
            rerun = false
            const pass = await embedPass()
            total += pass.embedded
            hubDown = pass.hubDown
        } while (rerun && !hubDown)
        return total
    })().finally(() => (running = null))
    return running
}

export function scheduleBrainEmbedding(): void {
    void embedPendingChunks().catch(err => logger.warn({ err: String(err) }, 'brain embedding pass failed'))
}
