import { RERUN_CONNECTION_ID, type Provider } from '@moldwright/contracts'
import { findConnection, listConnections } from './registry.js'
import type { LoadedConnection } from './types.js'

function byAge(connections: LoadedConnection[]): LoadedConnection[] {
    return [...connections].sort((a, b) => a.config.createdAt.localeCompare(b.config.createdAt) || a.id.localeCompare(b.id))
}

export async function connectionsOfProvider(provider: Provider): Promise<LoadedConnection[]> {
    return byAge((await listConnections()).filter(c => c.config.provider === provider))
}

export async function resolveConnection(connectionId: string | null | undefined, provider: Provider | null | undefined): Promise<LoadedConnection | null> {
    const direct = await findConnection(connectionId)
    if (direct) return direct
    if (provider) {
        const match = (await connectionsOfProvider(provider))[0]
        if (match) return match
    }
    return findConnection(RERUN_CONNECTION_ID)
}

export function servesModel(connection: LoadedConnection, model: string | null | undefined): boolean {
    if (!model) return false
    return connection.config.models.includes(model) || connection.config.extraModels.includes(model)
}
