import { canonicalModelId, providerSchema, type Provider } from '@rerun/contracts'

import type { BoxConnection } from '@/lib/engine/types'

export type ModelPin = { connectionId: string | null; provider: Provider | null; model: string | null }

const FOLLOW: ModelPin = { connectionId: null, provider: null, model: null }

export function connectionModels(connection: BoxConnection): string[] {
    return [...connection.models, ...connection.extraModels]
}

function servedModel(connection: BoxConnection, model: string): string | undefined {
    return connectionModels(connection).find(id => id === model || canonicalModelId(id) === canonicalModelId(model))
}

function describeConnection(connection: BoxConnection): string {
    return `${connection.id} ("${connection.name}", ${connection.provider}${connection.connected ? '' : ', not signed in'})`
}

function describeConnections(connections: BoxConnection[]): string {
    return connections.length > 0 ? connections.map(describeConnection).join(', ') : 'none'
}

function targetConnection(args: Record<string, unknown>, connections: BoxConnection[], currentConnectionId: string | null | undefined): BoxConnection {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : undefined
    const provider = typeof args.provider === 'string' ? args.provider : undefined
    const model = typeof args.model === 'string' ? args.model : undefined

    if (connectionId) {
        const connection = connections.find(entry => entry.id === connectionId)
        if (!connection) throw new Error(`Unknown AI connection "${connectionId}". This workspace has: ${describeConnections(connections)}.`)
        if (provider && provider !== connection.provider) throw new Error(`Connection "${connection.name}" is a ${connection.provider} connection, not ${provider}. Drop \`provider\` or pass a connection of that provider: ${describeConnections(connections)}.`)
        return connection
    }

    if (provider) {
        const parsed = providerSchema.safeParse(provider)
        if (!parsed.success) throw new Error(`Unknown provider "${provider}". Expected one of: ${providerSchema.options.join(', ')}`)
        const matches = connections.filter(entry => entry.provider === parsed.data)
        if (matches.length === 0) throw new Error(`This workspace has no ${provider} connection. It has: ${describeConnections(connections)}.`)
        if (matches.length > 1) throw new Error(`This workspace has several ${provider} connections, pass connectionId to say which: ${describeConnections(matches)}.`)
        return matches[0]
    }

    const current = connections.find(entry => entry.id === currentConnectionId)
    if (current && model && servedModel(current, model)) return current
    const serving = connections.filter(entry => model && servedModel(entry, model))
    if (serving.length === 1) return serving[0]
    if (serving.length === 0) throw new Error(`No AI connection of this workspace serves "${model}". Call list_ai_connections to read what each one offers.`)
    throw new Error(`Several AI connections serve "${model}", pass connectionId to say which: ${describeConnections(serving)}.`)
}

export function readModelPin(args: Record<string, unknown>, connections: BoxConnection[], currentConnectionId?: string | null): ModelPin | undefined {
    if (args.connectionId === undefined && args.provider === undefined && args.model === undefined) return undefined
    if (args.model === null) return FOLLOW
    if (typeof args.connectionId !== 'string' && typeof args.provider !== 'string' && typeof args.model !== 'string') return FOLLOW

    const connection = targetConnection(args, connections, currentConnectionId)
    if (!connection.connected) throw new Error(`Connection "${connection.name}" is not signed in, so nothing can run on it. The user reconnects it in AI providers.`)

    const offered = connectionModels(connection)
    if (typeof args.model !== 'string') {
        if (offered.length === 0) throw new Error(`Connection "${connection.name}" offers no model yet, pass \`model\`.`)
        return { connectionId: connection.id, provider: connection.provider, model: offered[0] }
    }

    const model = servedModel(connection, args.model)
    if (!model) throw new Error(`Connection "${connection.name}" does not serve "${args.model}". It serves: ${offered.join(', ') || 'nothing'}.`)
    return { connectionId: connection.id, provider: connection.provider, model }
}
