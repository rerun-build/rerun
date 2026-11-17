import { useEffect, useState } from 'react'

import { listComputers } from '@/api/computers'
import { useAuth } from '@/auth/AuthProvider'
import type { MentionComputer } from '@/components/chat/mentions'

// The computers `#` offers in the composer, read when the conversation opens.
export function useMentionComputers(): MentionComputer[] {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [computers, setComputers] = useState<MentionComputer[]>([])

    useEffect(() => {
        if (!accessToken || workspaceId === undefined) return
        let alive = true
        listComputers({ accessToken, workspaceId })
            .then(list => {
                if (alive) setComputers(list.map(({ id, name, handle, status }) => ({ id, name, handle, online: status !== 'offline' })))
            })
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [accessToken, workspaceId])

    return computers
}
