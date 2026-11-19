import { useMemo, type ReactNode } from 'react'

import { fetchBoard } from '@/api/board'
import { useAuth } from '@/auth/AuthProvider'
import { BuddyLooksProvider } from '@/components/buddy/looks'
import { useHub } from '@/data/hub-store'
import { cachedBoard } from '@/data/local-cache'
import { boardKey } from '@/data/useBoard'

// Every buddy of the app wears the look its coworker was given. It only listens to the board the
// Home reads, and never asks the hub itself.
export function CoworkerLooks({ children }: { children: ReactNode }) {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const persisted = useMemo(() => (workspaceId === undefined ? undefined : cachedBoard(workspaceId)), [workspaceId])
    const board = useHub(accessToken && workspaceId ? boardKey(workspaceId) : null, () => fetchBoard({ accessToken: accessToken!, workspaceId: workspaceId! }), { persisted, freshFor: Infinity, foreground: false })
    const looks = useMemo(() => new Map(board.value?.agents.flatMap(agent => (agent.look ? [[agent.id, agent.look] as const] : [])) ?? []), [board.value])
    return <BuddyLooksProvider looks={looks}>{children}</BuddyLooksProvider>
}
