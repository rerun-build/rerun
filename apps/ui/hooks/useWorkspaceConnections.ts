'use client'

import { createAiConnectionAction, deleteAiConnectionAction, listAiConnectionsAction, refreshAiConnectionsAction, setDefaultModelAction, updateAiConnectionAction, updateAiConnectionKeysAction } from '@/app/api/_actions/workspace-connection.actions'
import { invalidateLoadedAgentContexts } from '@/hooks/useAgentContext'
import { connectionMethod, trackAiConnectionConnected, trackAiConnectionFailed } from '@/lib/engine/ai-connection-analytics'
import type { BoxConnection, BoxDefault, CreateBoxConnectionInput, UpdateBoxConnectionInput } from '@/lib/engine/types'
import type { AiConnectionSurface } from '@rerun/analytics'
import { track } from '@rerun/analytics/client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

// The workspace's catalog of AI provider credentials. One fetch for the whole session, shared by
// the AI Providers dialog and by every agent's model picker: an agent no longer owns any of this,
// and neither does a Box.
//
// The list lives in a module-level store rather than in each hook's state, because the two
// surfaces are mounted at the same time: chats stay mounted while the dialog is open, so a
// provider plugged in there has to land in every model picker without a reload.
//
// Mutations update the shared list from the connection the engine echoes back, so a rename or a
// model toggle lands without a second round-trip.

type ConnectionsState = { connections: BoxConnection[]; boxDefault: BoxDefault | null; opencodeOffered: boolean; customOffered: boolean; loaded: boolean }

// A shared constant, since useSyncExternalStore compares snapshots by reference.
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

// Deduped: every mounted picker asks on mount, and they must add up to one request.
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

// A plan's limits move with every run, and the engine reads them as the run ends: a chat calls
// this when one finishes so the rings of its model pill follow. A read that fails leaves the list
// in place: an engine that just went away must not turn every picker into "Set up a model". A
// first load still in flight is waited for rather than reused, since it predates the run.
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

// `revalidate` is for the screen that manages the connections: it serves what the store holds and
// asks again on every mount, so the dialog reopened later shows its providers at once and then
// catches up. A model picker mounts with every tab and every composer swap, so it only asks when
// nothing is loaded yet; the mutations below keep the store current from there.
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

    // The engine re-resolves every agent against the connections it now holds, so each chat already
    // open re-reads the model it runs on rather than keeping the one it loaded with.
    const refreshAndReresolve = useCallback(async () => {
        await fetchList()
        invalidateLoadedAgentContexts()
    }, [])

    // The engine adopts the first connection plugged in as the default, and the created connection
    // it echoes back says nothing about which model it landed on: only a refetch does. The agents
    // re-read whatever the default did: one pinned by provider alone ran on the Rerun connection
    // until a connection of that provider existed, and this may be it.
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
            // Switching a model off can move the default server side, and only a refetch knows
            // where it landed.
            if (wasDefault) await refreshAndReresolve()
            return result
        },
        [refreshAndReresolve]
    )

    // Credentials never come back from the engine, so there is nothing to merge locally beyond the
    // `connected` flag — which only a refetch can tell us about.
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

    // Refetches rather than only dropping the row: the engine releases every agent and automation
    // that named the connection, and clears the default when this was the one holding it.
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

    // Optimistic: the engine echoes nothing back, and a star that waits for a round-trip to fill
    // reads as a click that did not land.
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
