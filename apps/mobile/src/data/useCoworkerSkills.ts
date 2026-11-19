import type { SkillSummary } from '@moldwright/contracts'
import { useEffect, useState } from 'react'

import { fetchCoworkerSkills } from '@/api/coworker'
import { useAuth } from '@/auth/AuthProvider'

const known = new Map<string, SkillSummary[]>()

export function useCoworkerSkills(agentId: string | null): SkillSummary[] {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [read, setRead] = useState<{ agentId: string; skills: SkillSummary[] } | null>(null)

    useEffect(() => {
        if (!agentId || !accessToken || workspaceId === undefined) return
        let alive = true
        fetchCoworkerSkills({ accessToken, workspaceId }, agentId)
            .then(skills => {
                known.set(agentId, skills)
                if (alive) setRead({ agentId, skills })
            })
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [agentId, accessToken, workspaceId])

    if (!agentId) return []
    return read?.agentId === agentId ? read.skills : (known.get(agentId) ?? [])
}
