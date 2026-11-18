'use client'

import { useSyncExternalStore } from 'react'
import { listAgentConnectorsAction } from '@/app/api/_actions/custom-mcp.actions'
import { buildConnectorMap, type ConnectorMap } from '@/lib/chat/connector-tools'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'

// The mcp server name → connector map lives in the agent's own registry on its Box, so it costs an
// engine round trip while every tool row of every message needs it, and the agent panel needs the
// same read for the dot on its Apps tab. Hence one module-level store shared by all of them: a
// single fetch per agent per page session.

// `needsConfig`: a catalog connector the user has to act on before it works, a missing sign-in just as
// much as a missing credential. A custom server's sign-in is only known from a live probe, so it never
// counts here. `custom`: the servers registered outside the catalog.
export type ConnectorServices = { map: ConnectorMap; needsConfig: boolean; custom: CustomMcpServer[]; loaded: boolean }

const EMPTY_MAP: ConnectorMap = new Map()
const EMPTY: ConnectorServices = { map: EMPTY_MAP, needsConfig: false, custom: [], loaded: false }

function fromInstalled(services: InstalledService[], custom: CustomMcpServer[]): ConnectorServices {
    return { map: buildConnectorMap(services, custom), needsConfig: services.some(s => s.status === 'needs_config' || s.status === 'needs_auth'), custom, loaded: true }
}

const snapshots = new Map<string, ConnectorServices>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()
// An invalidation asked while a read runs has to read again once it lands: the read may predate the change.
const rerun = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

// listAgentConnectorsAction already swallows every failure and answers empty lists, so an asleep Box, an
// unreachable engine and an agent without connectors all settle on the same loaded empty map. The
// previous snapshot stays in place while the read runs: every tool row of the chat reads this store,
// and would otherwise flash back to its generic icon on each refresh.
async function load(agentId: string) {
    if (inflight.has(agentId)) {
        rerun.add(agentId)
        return
    }
    inflight.add(agentId)
    try {
        const { services, custom } = await listAgentConnectorsAction(agentId)
        snapshots.set(agentId, fromInstalled(services, custom))
    } catch {
        snapshots.set(agentId, { ...EMPTY, loaded: true })
    } finally {
        inflight.delete(agentId)
    }
    emit(agentId)
    if (rerun.delete(agentId)) void load(agentId)
}

function subscribe(agentId: string, listener: () => void) {
    let set = listeners.get(agentId)
    if (!set) {
        set = new Set()
        listeners.set(agentId, set)
    }
    set.add(listener)
    // A subscriber arriving while the first read runs waits for it: asking again would queue a
    // second read of the same registry behind it.
    if (!snapshots.has(agentId) && !inflight.has(agentId)) void load(agentId)
    return () => {
        set.delete(listener)
    }
}

export function invalidateConnectorServices(agentId: string) {
    void load(agentId)
}

// For a caller that just listed the agent's connectors for its own needs: feeding the store spares
// the engine a second read of the same registry.
export function setConnectorServices(agentId: string, services: InstalledService[], custom: CustomMcpServer[]) {
    snapshots.set(agentId, fromInstalled(services, custom))
    emit(agentId)
}

export function useConnectorServices(agentId?: string): ConnectorServices {
    return useSyncExternalStore(
        cb => (agentId ? subscribe(agentId, cb) : () => {}),
        () => (agentId ? (snapshots.get(agentId) ?? EMPTY) : EMPTY),
        () => EMPTY,
    )
}
