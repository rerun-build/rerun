'use client'

import { createAiConnectionAction, deleteAiConnectionAction, listAiConnectionsAction, refreshAiConnectionsAction, setDefaultModelAction, updateAiConnectionAction, updateAiConnectionKeysAction } from '@/app/api/_actions/workspace-connection.actions'
import { invalidateLoadedAgentContexts } from '@/hooks/useAgentContext'
import { connectionMethod, trackAiConnectionConnected, trackAiConnectionFailed } from '@/lib/engine/ai-connection-analytics'
import type { BoxConnection, BoxDefault, CreateBoxConnectionInput, UpdateBoxConnectionInput } from '@/lib/engine/types'
import type { AiConnectionSurface } from '@rerun/analytics'
import { track } from '@rerun/analytics/client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

type ConnectionsState = { connections: BoxConnection[]; boxDefault: BoxDefault | null; opencodeOffered: boolean; customOffered: boolean; loaded: boolean }

const EMPTY: ConnectionsState = { connections: [], boxDefault: null, opencodeOffered: false, customOffered: false, loaded: false }

let snapshot: ConnectionsState = EMPTY
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function setState(patch: Partial<ConnectionsState>) {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function fetchList(): Promise<void> {
    if (inflight) return inflight
    inflight = listAiConnectionsAction()
        .then(list => setState({ connections: list.connections, boxDefault: list.default, opencodeOffered: list.opencodeOffered, customOffered: list.customOffered, loaded: true }))
        .catch(() => {})
        .finally(() => {
            inflight = null
        })
    return inflight
}

let refreshing: Promise<void> | null = null

export function refreshWorkspaceConnections(): Promise<void> {
    if (refreshing) return refreshing
    refreshing = (async () => {
        if (inflight) await inflight
        const list = await refreshAiConnectionsAction()
        if (list) setState({ connections: list.connections, boxDefault: list.default, opencodeOffered: list.opencodeOffered, customOffered: list.customOffered, loaded: true })
    })().finally(() => {
        refreshing = null
    })
    return refreshing
}

export function useWorkspaceConnections({ revalidate = false }: { revalidate?: boolean } = {}) {
    const state = useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => EMPTY
    )

    useEffect(() => {
        if (revalidate || !snapshot.loaded) void fetchList()
    }, [revalidate])

    const refresh = useCallback(() => fetchList(), [])

    const refreshAndReresolve = useCallback(async () => {
        await fetchList()
        invalidateLoadedAgentContexts()
    }, [])

    const create = useCallback(
        async (params: CreateBoxConnectionInput, surface: AiConnectionSurface) => {
            const hadDefault = snapshot.boxDefault !== null
            const keys = params.keys ?? {}
            const result = await createAiConnectionAction(params)
            if (result.success) {
                trackAiConnectionConnected(params.provider, keys, surface)
                setState({ connections: [...snapshot.connections, result.connection] })
                if (!hadDefault) await refresh()
                invalidateLoadedAgentContexts()
            } else {
                trackAiConnectionFailed(params.provider, connectionMethod(params.provider, keys), surface, 'rejected', result.error)
            }
            return result
        },
        [refresh]
    )

    const update = useCallback(
        async (id: string, patch: UpdateBoxConnectionInput) => {
            const result = await updateAiConnectionAction(id, patch)
            if (!result.success) return result
            const wasDefault = snapshot.boxDefault?.connectionId === id
            setState({ connections: snapshot.connections.map(c => (c.id === id ? result.connection : c)) })
            if (wasDefault) await refreshAndReresolve()
            return result
        },
        [refreshAndReresolve]
    )

    const updateKeys = useCallback(
        async (id: string, body: { set?: Record<string, string>; remove?: string[] }, surface: AiConnectionSurface) => {
            const provider = snapshot.connections.find(c => c.id === id)?.provider
            const result = await updateAiConnectionKeysAction(id, body)
            if (provider && body.set) {
                if (result.success) trackAiConnectionConnected(provider, body.set, surface)
                else trackAiConnectionFailed(provider, connectionMethod(provider, body.set), surface, 'rejected', result.error)
            }
            if (result.success) await refreshAndReresolve()
            return result
        },
        [refreshAndReresolve]
    )

    const remove = useCallback(
        async (id: string) => {
            const provider = snapshot.connections.find(c => c.id === id)?.provider
            const result = await deleteAiConnectionAction(id)
            if (result.success) {
                if (provider) track('ai_connection_disconnected', { provider })
                setState({ connections: snapshot.connections.filter(c => c.id !== id) })
                await refreshAndReresolve()
            }
            return result
        },
        [refreshAndReresolve]
    )

    const setDefault = useCallback(async (pick: BoxDefault | null) => {
        const previous = snapshot.boxDefault
        setState({ boxDefault: pick })
        const result = await setDefaultModelAction(pick)
        if (result.success) invalidateLoadedAgentContexts()
        else setState({ boxDefault: previous })
        return result
    }, [])

    return { connections: state.connections, boxDefault: state.boxDefault, opencodeOffered: state.opencodeOffered, customOffered: state.customOffered, loading: !state.loaded, refresh, create, update, updateKeys, remove, setDefault }
}
