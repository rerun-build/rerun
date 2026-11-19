import type { BoardAgent } from '@rerun/contracts'

import { fetchBoardAgents } from '@/api/board'
import { useAuth } from '@/auth/AuthProvider'
import { useHub } from '@/data/hub-store'
import { cachedBoard } from '@/data/local-cache'

// The coworkers of the workspace, for a screen that names or draws them outside the Home: served from
// the board the Home kept while a fresh read lands. Null until either answers.
export function useWorkspaceAgents(): BoardAgent[] | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const { value } = useHub(accessToken && workspaceId !== undefined ? `agents:${workspaceId}` : null, () => fetchBoardAgents({ accessToken: accessToken!, workspaceId: workspaceId! }))
    return value ?? (workspaceId === undefined ? null : (cachedBoard(workspaceId).read()?.agents ?? null))
}
