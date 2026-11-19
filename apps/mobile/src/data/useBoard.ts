import type { Box } from '@rerun/contracts'
import { useCallback, useId, useMemo } from 'react'

import { fetchBoard, type BoardRead } from '@/api/board'
import { useAuth } from '@/auth/AuthProvider'
import { toHomeCoworkers, type HomeCoworker } from '@/components/home/board'
import { useHub } from '@/data/hub-store'
import { cachedBoard } from '@/data/local-cache'
import { useBurstReload, useLiveReload } from '@/data/useLiveReload'

// `fresh`: read from the hub since the screen opened, not the copy the phone kept from the last visit.
type Board = { state: 'loading' } | { state: 'error' } | { state: 'ready'; coworkers: HomeCoworker[]; boxes: Box[]; fresh: boolean }

const boardOf = ({ agents, overview, boxes }: BoardRead, fresh: boolean): Board => ({ state: 'ready', coworkers: toHomeCoworkers(agents, overview), boxes, fresh })

export function boardKey(workspaceId: number) {
    return `board:${workspaceId}`
}

// Realtime takes at most this many values in an `in` filter; a larger workspace hears every session.
const FILTERED_AGENTS_MAX = 100

// The sessions of the Home's coworkers only, rather than every session the caller may read: a busy
// workspace's runs elsewhere no longer wake the Home. A new coworker changes the agents first, which
// opens a channel that names it.
export function sessionsFilterOf(agentIds: readonly string[]): string | undefined {
    if (agentIds.length === 0 || agentIds.length > FILTERED_AGENTS_MAX) return undefined
    return `agent_id=in.(${[...agentIds].sort().join(',')})`
}

function digestOf(text: string): string {
    let hash = 5381
    for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) | 0
    return (hash >>> 0).toString(36)
}

// The coworkers of the active workspace with their latest conversation, read again whenever an agent
// or a session changes in Realtime, and when the app comes back to the foreground, where Realtime
// may have missed what happened while iOS held the app. A workspace already read opens on its rows,
// and an answer that changed nothing leaves the Home as it is.
export function useBoard(): Board & { reload: () => void } {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const userId = me?.user.id
    const persisted = useMemo(() => (workspaceId === undefined ? undefined : cachedBoard(workspaceId)), [workspaceId])
    const read = useHub(accessToken && workspaceId ? boardKey(workspaceId) : null, () => fetchBoard({ accessToken: accessToken!, workspaceId: workspaceId! }), { persisted, freshFor: 0, foreground: false })
    const { reload: readAgain } = read
    const reload = useCallback(() => void readAgain(), [readAgain])
    const reloadSoon = useBurstReload(reload)

    // The coworker list can be mounted twice for a moment (the Home leaving the stack as the sidebar of a
    // wide window takes over): supabase.channel() hands back the instance of a topic already taken.
    const channelId = useId()
    const agentIds = useMemo(() => read.value?.agents.map(agent => agent.id) ?? [], [read.value])
    const sessionsFilter = sessionsFilterOf(agentIds)
    useLiveReload(
        workspaceId ? `home:${workspaceId}:${userId ?? ''}:${digestOf(sessionsFilter ?? '')}:${channelId}` : null,
        (channel, changed) => {
            channel
                .on('postgres_changes', { event: '*', schema: 'public', table: 'agents', filter: `workspace_id=eq.${workspaceId}` }, changed)
                // A delete only carries the primary key, so the workspace filter above never lets one through.
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'agents' }, changed)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', ...(sessionsFilter ? { filter: sessionsFilter } : {}) }, changed)
                // As for agents, a delete only carries the primary key: no filter on the coworkers lets one through.
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions' }, changed)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces', filter: `workspace_id=eq.${workspaceId}` }, changed)
            // A Box named to the caller or taken back from them: its coworkers appear or leave the home.
            if (userId) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'space_members', filter: `user_id=eq.${userId}` }, changed)
        },
        reloadSoon
    )

    const board = useMemo((): Board => (read.value ? boardOf(read.value, read.fresh) : read.failed ? { state: 'error' } : { state: 'loading' }), [read.value, read.fresh, read.failed])
    return { ...board, reload }
}
