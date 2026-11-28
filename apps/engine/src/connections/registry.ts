import { notFound } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { clearAgentCache } from '../agents/registry.js'
import { isPathSegment } from '../config/paths.js'
import { connectionExists, listConnectionIds, loadConnectionFromDisk } from './loader.js'
import type { LoadedConnection } from './types.js'

// One instance per connection, shared by every agent pointing at it. Deliberate: a token refresh
// mutates this single object, so the whole box sees the fresh credential at once instead of each
// agent carrying its own copy and racing to rotate it. The read is cached, not its result: two first
// reads at once (the boot's and the scheduler's) would otherwise build two objects, and a Claude
// refresh on one would leave the other with a refresh token Anthropic has already spent.
const cache = new Map<string, Promise<LoadedConnection>>()

export async function getConnection(id: string): Promise<LoadedConnection> {
    const cached = cache.get(id)
    if (cached) return cached
    if (!connectionExists(id)) throw notFound('connection')
    const loading = loadConnectionFromDisk(id)
    cache.set(id, loading)
    loading.catch(() => {
        if (cache.get(id) === loading) cache.delete(id)
    })
    return loading
}

const unreadable = new Set<string>()

// A connection this engine cannot read, such as one a newer engine wrote for a provider this one
// does not know, is left out rather than failing every list, run and fallback with it: an engine
// rolled back under a box keeps running on the connections it does know. Said once per connection.
async function readableConnection(id: string): Promise<LoadedConnection | null> {
    try {
        return await getConnection(id)
    } catch (error) {
        if (!unreadable.has(id)) logger.warn({ connection: id, err: error instanceof Error ? error.message : String(error) }, 'connection left out: this engine cannot read it')
        unreadable.add(id)
        return null
    }
}

export async function findConnection(id: string | null | undefined): Promise<LoadedConnection | null> {
    if (!id || !isPathSegment(id) || !connectionExists(id)) return null
    return readableConnection(id)
}

export async function listConnections(): Promise<LoadedConnection[]> {
    const ids = await listConnectionIds()
    const connections = await Promise.all(ids.map(readableConnection))
    return connections.filter((connection): connection is LoadedConnection => connection !== null)
}

// Agents hold a reference to the shared instance, so dropping a connection from the cache has to
// drop them too — otherwise a reloaded connection would leave every agent on the stale object.
export function unloadConnection(id: string): void {
    cache.delete(id)
    clearAgentCache()
}

export async function reloadConnection(id: string): Promise<LoadedConnection> {
    unloadConnection(id)
    return getConnection(id)
}
