'use client'

import { boxAccessFor, type BoxAccess, type BoxViewer } from '@/lib/board/box-access'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useMemo } from 'react'

export function useBoxViewer(): BoxViewer {
    const { user, role, boxScope } = useSession()
    const userId = user?.id ?? null
    return useMemo(() => ({ userId, role, boxScope }), [userId, role, boxScope])
}

export function useSpaceAccess(spaceId: string | null | undefined): BoxAccess {
    const viewer = useBoxViewer()
    const space = useBoardStore(state => (spaceId ? state.spaces.find(s => s.id === spaceId) : undefined))
    const grants = useBoardStore(state => state.spaceGrants)
    return boxAccessFor(viewer, space, grants)
}

export function useAgentAccess(agentId: string | null | undefined): BoxAccess {
    const spaceId = useBoardStore(state => (agentId ? state.agents.find(a => a.id === agentId)?.spaceId : undefined))
    return useSpaceAccess(spaceId)
}

export function useCanManageAgent(agentId: string | null | undefined): boolean {
    return useAgentAccess(agentId) === 'manage'
}

export function useCanManageSpace(spaceId: string | null | undefined): boolean {
    return useSpaceAccess(spaceId) === 'manage'
}

export function useManageableSpaceIds(): Set<string> {
    const viewer = useBoxViewer()
    const spaces = useBoardStore(state => state.spaces)
    const grants = useBoardStore(state => state.spaceGrants)
    return useMemo(() => new Set(spaces.filter(space => boxAccessFor(viewer, space, grants) === 'manage').map(space => space.id)), [viewer, spaces, grants])
}
