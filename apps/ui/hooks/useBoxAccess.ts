'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { boxAccessFor, type BoxAccess, type BoxViewer } from '@/lib/board/box-access'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useMemo } from 'react'

export function useBoxViewer(): BoxViewer {
    const { user, role, boxScope } = useSession()
    const userId = user?.id ?? null
    return useMemo(() => ({ userId, role, boxScope }), [userId, role, boxScope])
}

// The caller's level on a Box, from the board's own rows. `none` while the session is still loading,
// so a manage-only control starts disabled rather than flashing open.
export function useSpaceAccess(spaceId: string | null | undefined): BoxAccess {
    const viewer = useBoxViewer()
    const space = useBoardStore(state => (spaceId ? state.spaces.find(s => s.id === spaceId) : undefined))
    const grants = useBoardStore(state => state.spaceGrants)
    return boxAccessFor(viewer, space, grants)
}

// A coworker carries no access of its own: it is its Box's. The Chief of Staff sits in no Box: every
// member reaches it, and a workspace admin changes what it keeps.
export function useAgentAccess(agentId: string | null | undefined): BoxAccess {
    const { role } = useBoxViewer()
    const spaceId = useBoardStore(state => (agentId ? state.agents.find(a => a.id === agentId)?.spaceId : undefined))
    const boxAccess = useSpaceAccess(spaceId)
    if (agentId !== FOREMAN_AGENT_ID) return boxAccess
    if (!role) return 'none'
    return role === 'admin' ? 'manage' : 'use'
}

export function useCanManageAgent(agentId: string | null | undefined): boolean {
    return useAgentAccess(agentId) === 'manage'
}

export function useCanManageSpace(spaceId: string | null | undefined): boolean {
    return useSpaceAccess(spaceId) === 'manage'
}

// The Boxes a coworker may be created in or moved to.
export function useManageableSpaceIds(): Set<string> {
    const viewer = useBoxViewer()
    const spaces = useBoardStore(state => state.spaces)
    const grants = useBoardStore(state => state.spaceGrants)
    return useMemo(() => new Set(spaces.filter(space => boxAccessFor(viewer, space, grants) === 'manage').map(space => space.id)), [viewer, spaces, grants])
}
