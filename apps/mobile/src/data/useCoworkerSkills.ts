import type { SkillSummary } from '@rerun/contracts'

import { fetchCoworkerSkills } from '@/api/coworker'
import { useAuth } from '@/auth/AuthProvider'
import { useHub } from '@/data/hub-store'

const NONE: SkillSummary[] = []

// The skills a coworker offers the composer's `/` menu, read once for all of its conversations. The
// last list read opens the next conversation while a fresh one lands; a hub that cannot answer leaves
// the menu empty.
export function useCoworkerSkills(agentId: string | null): SkillSummary[] {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const ready = agentId && accessToken && workspaceId !== undefined
    const { value } = useHub(ready ? `skills:${workspaceId}:${agentId}` : null, () => fetchCoworkerSkills({ accessToken: accessToken!, workspaceId: workspaceId! }, agentId!))
    return (agentId && value) || NONE
}
