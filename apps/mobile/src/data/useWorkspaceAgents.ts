import type { BoardAgent } from '@rerun/contracts'
import { useEffect, useState } from 'react'

import { fetchBoardAgents } from '@/api/board'
import { useAuth } from '@/auth/AuthProvider'
import { cachedBoard } from '@/data/local-cache'

export function useWorkspaceAgents(): BoardAgent[] | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [agents, setAgents] = useState<BoardAgent[] | null>(() => (workspaceId === undefined ? null : (cachedBoard(workspaceId).read()?.agents ?? null)))

    useEffect(() => {
        if (!accessToken || workspaceId === undefined) return
        let alive = true
        fetchBoardAgents({ accessToken, workspaceId })
            .then(list => {
                if (alive) setAgents(list)
            })
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [accessToken, workspaceId])

    return agents
}
