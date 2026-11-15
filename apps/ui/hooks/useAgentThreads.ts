'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { listAgentThreadsAction } from '@/app/api/_actions/session.actions'
import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { useBoardStore } from '@/stores/board.store'

const REFRESH_DEBOUNCE_MS = 500

export function useAgentThreads(agentId: string): { threads: ThreadRow[]; refresh: () => void } {
    const [rows, setRows] = useState<ThreadRow[]>([])
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const refresh = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            timer.current = null
            void listAgentThreadsAction(agentId).then(setRows).catch(() => {})
        }, REFRESH_DEBOUNCE_MS)
    }, [agentId])

    useEffect(() => {
        let alive = true
        setRows([])
        listAgentThreadsAction(agentId)
            .then(threads => alive && setRows(threads))
            .catch(() => {})
        return () => {
            alive = false
            if (timer.current) clearTimeout(timer.current)
        }
    }, [agentId])

    const sessions = useBoardStore(s => s.sessions)
    const statusById = useMemo(() => new Map(sessions.map(session => [session.id, session.status])), [sessions])

    const threads = useMemo(() => rows.map(row => ({ ...row, status: statusById.get(row.id) ?? row.status })), [rows, statusById])
    return { threads, refresh }
}
