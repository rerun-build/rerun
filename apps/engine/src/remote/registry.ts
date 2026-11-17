import { REMOTE_CLOSE, type RemoteComputerIdentity, type RemoteComputerView, type RemoteEventFrame } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import type { RemoteConnection } from './connection.js'
import { readComputers, recordConnection, recordSeen, removeComputer, type StoredComputer } from './store.js'

// The computers connected right now, one socket each. A new connection of the same computer replaces
// the old one: a laptop that changed network reconnects before the old socket times out.
const live = new Map<string, RemoteConnection>()

type EventListener = (computerId: string, event: RemoteEventFrame, connection: RemoteConnection) => void
const eventListeners = new Set<EventListener>()

// What a computer tells on its own (a job ended), for whoever acts on it.
export function onRemoteEvent(listener: EventListener): () => void {
    eventListeners.add(listener)
    return () => eventListeners.delete(listener)
}

export function liveConnection(computerId: string): RemoteConnection | null {
    const connection = live.get(computerId)
    return connection?.open ? connection : null
}

export function liveConnectionCount(): number {
    return [...live.values()].filter(connection => connection.open).length
}

export async function registerConnection(identity: RemoteComputerIdentity, connection: RemoteConnection): Promise<void> {
    live.get(identity.id)?.close(REMOTE_CLOSE.replaced, 'replaced')
    live.set(identity.id, connection)
    connection.onEvent(event => {
        for (const listener of eventListeners) listener(identity.id, event, connection)
    })
    connection.onClose(() => {
        if (live.get(identity.id) === connection) live.delete(identity.id)
        logger.info({ computerId: identity.id, connectedFor: Date.now() - connection.connectedAt.getTime() }, 'remote computer disconnected')
        void recordSeen(identity.id, connection.lastSeenAt.toISOString()).catch(err => logger.warn({ err: String(err) }, 'remote computer last seen not saved'))
    })
    await recordConnection(identity, { appVersion: connection.appVersion, protocol: connection.protocol, capabilities: [...connection.capabilities], facts: connection.facts, at: connection.connectedAt.toISOString() })
    logger.info({ computerId: identity.id, protocol: connection.protocol, app: connection.appVersion, os: connection.facts.os }, 'remote computer connected')
}

export function viewOf(computer: StoredComputer): RemoteComputerView {
    const connection = liveConnection(computer.id)
    return {
        id: computer.id,
        handle: computer.handle,
        name: computer.name,
        online: !!connection,
        paused: connection?.paused ?? false,
        connectedAt: connection?.connectedAt.toISOString() ?? null,
        lastSeenAt: connection?.lastSeenAt.toISOString() ?? computer.lastSeenAt,
        appVersion: connection?.appVersion ?? computer.appVersion,
        protocol: connection?.protocol ?? computer.protocol,
        capabilities: connection ? [...connection.capabilities] : computer.capabilities,
        facts: connection?.facts ?? computer.facts,
        settings: computer.settings,
        runningJobs: connection?.runningJobs ?? 0,
    }
}

export async function listComputerViews(): Promise<RemoteComputerView[]> {
    return (await readComputers()).map(viewOf)
}

// The hub unlinked it: its socket is closed with a code that tells the app not to come back.
export async function forgetComputer(computerId: string): Promise<boolean> {
    live.get(computerId)?.close(REMOTE_CLOSE.revoked, 'revoked')
    live.delete(computerId)
    return removeComputer(computerId)
}
