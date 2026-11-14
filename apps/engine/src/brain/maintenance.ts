import { getBrainDb } from '../db/brainDb.js'
import { logger } from '../lib/logger.js'
import { embedPendingChunks } from './embedding.js'
import { indexPage, listPageFiles, unindexPage } from './pages.js'

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000

let lastRunAt = 0

export async function syncBrainIndex(): Promise<{ reindexed: number; removed: number }> {
    const client = await getBrainDb()
    const [files, rs] = await Promise.all([listPageFiles(), client.execute('SELECT slug, hash FROM brain_pages')])
    const indexed = new Map(rs.rows.map(r => [String(r.slug), String(r.hash)]))
    let reindexed = 0
    for (const file of files) {
        if (indexed.get(file.slug) !== file.hash) {
            await indexPage(file)
            reindexed++
        }
        indexed.delete(file.slug)
    }
    for (const slug of indexed.keys()) await unindexPage(slug)
    return { reindexed, removed: indexed.size }
}

export async function maintainBrain(): Promise<void> {
    const synced = await syncBrainIndex()
    if (synced.reindexed || synced.removed) logger.info(synced, 'brain index resynced from disk')
    const embedded = await embedPendingChunks()
    if (embedded) logger.info({ embedded }, 'brain chunks embedded')
}

export async function maintainBrainIfDue(): Promise<void> {
    const now = Date.now()
    if (now - lastRunAt < MAINTENANCE_INTERVAL_MS) return
    lastRunAt = now
    await maintainBrain().catch(err => logger.error({ err: String(err) }, 'brain maintenance failed'))
}
