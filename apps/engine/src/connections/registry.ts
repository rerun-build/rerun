import { notFound } from '../lib/errors.js'
import { clearAgentCache } from '../agents/registry.js'
import { isPathSegment } from '../config/paths.js'
import { connectionExists, listConnectionIds, loadConnectionFromDisk } from './loader.js'
import type { LoadedConnection } from './types.js'

const cache = new Map<string, LoadedConnection>()

export async function getConnection(id: string): Promise<LoadedConnection> {
    const cached = cache.get(id)
    if (cached) return cached
    if (!connectionExists(id)) throw notFound('connection')
    const connection = await loadConnectionFromDisk(id)
    cache.set(id, connection)
    return connection
}

export async function findConnection(id: string | null | undefined): Promise<LoadedConnection | null> {
    if (!id || !isPathSegment(id) || !connectionExists(id)) return null
    return getConnection(id)
}

export async function listConnections(): Promise<LoadedConnection[]> {
    const ids = await listConnectionIds()
    return Promise.all(ids.map(id => getConnection(id)))
}

export function unloadConnection(id: string): void {
    cache.delete(id)
    clearAgentCache()
}

export async function reloadConnection(id: string): Promise<LoadedConnection> {
    unloadConnection(id)
    return getConnection(id)
}
