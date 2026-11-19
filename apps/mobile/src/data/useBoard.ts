import type { Box } from '@moldwright/contracts'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { fetchBoard, type BoardRead } from '@/api/board'
import { useAuth } from '@/auth/AuthProvider'
import { toHomeCoworkers, type HomeCoworker } from '@/components/home/board'
import { cachedBoard } from '@/data/local-cache'
import { useLiveReload } from '@/data/useLiveReload'

type Board = { state: 'loading' } | { state: 'error' } | { state: 'ready'; coworkers: HomeCoworker[]; boxes: Box[]; fresh: boolean }

const boardOf = ({ agents, overview, boxes }: BoardRead, fresh: boolean): Board => ({ state: 'ready', coworkers: toHomeCoworkers(agents, overview), boxes, fresh })

const BURST_MS = 400

export function useBoard(): Board & { reload: () => void } {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const userId = me?.user.id
    const [read, setRead] = useState<{ workspaceId: number; board: Board } | null>(null)
    const [version, setVersion] = useState(0)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const reload = useCallback(() => setVersion(current => current + 1), [])
    const reloadSoon = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(reload, BURST_MS)
    }, [reload])

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        let cancelled = false
        const caller = { accessToken, workspaceId }
        cachedBoard(workspaceId)
            .load(() => fetchBoard(caller))
            .then(fresh => {
                if (!cancelled) setRead({ workspaceId, board: boardOf(fresh, true) })
            })
            .catch(() => {
                if (cancelled) return
                const kept = cachedBoard(workspaceId).read()
                setRead(current => (current?.workspaceId === workspaceId && current.board.state === 'ready' ? current : { workspaceId, board: kept ? boardOf(kept, false) : { state: 'error' } }))
            })
        return () => {
            cancelled = true
        }
    }, [accessToken, workspaceId, version])

    const channelId = useId()
    useLiveReload(
        workspaceId ? `home:${workspaceId}:${userId ?? ''}:${channelId}` : null,
        (channel, changed) => {
            channel
                .on('postgres_changes', { event: '*', schema: 'public', table: 'agents', filter: `workspace_id=eq.${workspaceId}` }, changed)
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'agents' }, changed)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, changed)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces', filter: `workspace_id=eq.${workspaceId}` }, changed)
            if (userId) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'space_members', filter: `user_id=eq.${userId}` }, changed)
        },
        reloadSoon
    )
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
        },
        []
    )

    const kept = useMemo(() => {
        if (!workspaceId || read?.workspaceId === workspaceId) return null
        const stored = cachedBoard(workspaceId).read()
        return stored ? boardOf(stored, false) : null
    }, [workspaceId, read?.workspaceId])
    const board: Board = read && read.workspaceId === workspaceId ? read.board : (kept ?? { state: 'loading' })
    return { ...board, reload }
}
