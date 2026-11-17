import { FOREMAN_AGENT_ID, type BoxAccessLevel } from '@rerun/contracts'
import { useEffect, useMemo, useState } from 'react'

import { fetchAgentView } from '@/api/chat'
import { knownCoworkerAccess, UNKNOWN_ACCESS, type CoworkerAccess } from '@/auth/access'
import { useAuth } from '@/auth/AuthProvider'
import { cachedBoard, loadCoworkerDetail, readCoworkerDetails, readCoworkerScreen } from '@/data/local-cache'

// The caller's level on a coworker, for a screen opened with only its id (the chat's model sheet, a
// card opening its apps). The copy the phone kept answers first, the hub is always asked and its
// answer wins: a Box handed over or taken back since the last visit shows on the next open.
export function useCoworkerAccess(agentId: string): CoworkerAccess {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const role = me?.workspace.role
    const foreman = agentId === FOREMAN_AGENT_ID
    const kept = useMemo(
        () => (workspaceId ? knownCoworkerAccess(agentId, { agents: cachedBoard(workspaceId).read()?.agents, views: [readCoworkerScreen(workspaceId, agentId).view, readCoworkerDetails(workspaceId, agentId).view], role }) : UNKNOWN_ACCESS),
        [workspaceId, agentId, role]
    )
    const askedFor = `${workspaceId}:${agentId}`
    const [fetched, setFetched] = useState<{ askedFor: string; access: BoxAccessLevel | undefined } | null>(null)

    useEffect(() => {
        if (!accessToken || !workspaceId || foreman) return
        let cancelled = false
        loadCoworkerDetail(workspaceId, agentId, 'view', () => fetchAgentView({ accessToken, workspaceId }, agentId))
            .then(view => {
                if (!cancelled) setFetched({ askedFor: `${workspaceId}:${agentId}`, access: view.agent.access })
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [accessToken, workspaceId, agentId, foreman])

    if (fetched?.askedFor === askedFor) return { access: fetched.access, known: true }
    return kept
}
