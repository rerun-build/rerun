'use client'

import { useSyncExternalStore } from 'react'
import { listAgentConnectorsAction } from '@/app/api/_actions/custom-mcp.actions'
import { buildConnectorMap, type ConnectorMap } from '@/lib/chat/connector-tools'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'

export type ConnectorServices = { map: ConnectorMap; needsConfig: boolean; custom: CustomMcpServer[]; loaded: boolean }

const EMPTY_MAP: ConnectorMap = new Map()
const EMPTY: ConnectorServices = { map: EMPTY_MAP, needsConfig: false, custom: [], loaded: false }

function fromInstalled(services: InstalledService[], custom: CustomMcpServer[]): ConnectorServices {
    return { map: buildConnectorMap(services, custom), needsConfig: services.some(s => s.status === 'needs_config' || s.status === 'needs_auth'), custom, loaded: true }
}

const snapshots = new Map<string, ConnectorServices>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()
const rerun = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

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
    if (!snapshots.has(agentId)) void load(agentId)
    return () => {
        set.delete(listener)
    }
}

export function invalidateConnectorServices(agentId: string) {
    void load(agentId)
}

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
