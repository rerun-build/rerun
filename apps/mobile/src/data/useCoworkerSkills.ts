import type { SkillSummary } from '@rerun/contracts'

import { fetchCoworkerSkills } from '@/api/coworker'
import { useAuth } from '@/auth/AuthProvider'
import { useHub } from '@/data/hub-store'

// The skills a coworker offers the composer's `/` menu, read once for all of its conversations. The
// last list read opens the next conversation while a fresh one lands; `null` until the hub has answered.
export function useCoworkerSkills(agentId: string | null): SkillSummary[] | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const ready = agentId && accessToken && workspaceId !== undefined
    const { value } = useHub(ready ? `skills:${workspaceId}:${agentId}` : null, () => fetchCoworkerSkills({ accessToken: accessToken!, workspaceId: workspaceId! }, agentId!))
    return agentId ? value : null
}
