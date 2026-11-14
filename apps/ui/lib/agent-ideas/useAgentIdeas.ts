'use client'

import { useEffect, useState } from 'react'

import { loadAgentIdeasAction } from '@/app/api/_actions/agent-ideas.actions'
import { useSession } from '@/supabase/session/SessionProvider'
import type { StoredAgentIdeas, StoredIdea } from './stored'

const settled = new Map<number, StoredIdea[]>()
const loading = new Map<number, Promise<StoredAgentIdeas | null>>()

const NO_IDEAS: StoredIdea[] = []

function loadIdeas(workspaceId: number): Promise<StoredIdea[]> {
    let pending = loading.get(workspaceId)
    if (!pending) {
        pending = loadAgentIdeasAction().finally(() => loading.delete(workspaceId))
        loading.set(workspaceId, pending)
    }
    return pending.then(row => {
        if (row?.status === 'running') return NO_IDEAS
        const ideas = row?.ideas ?? NO_IDEAS
        settled.set(workspaceId, ideas)
        return ideas
    })
}

export function useAgentIdeas(refreshKey: unknown = null): StoredIdea[] {
    const workspaceId = useSession().workspace?.id ?? null
    const [loaded, setLoaded] = useState<{ workspaceId: number; ideas: StoredIdea[] } | null>(null)

    useEffect(() => {
        if (workspaceId === null || settled.has(workspaceId)) return
        let active = true
        loadIdeas(workspaceId).then(
            ideas => {
                if (active) setLoaded({ workspaceId, ideas })
            },
            () => {}
        )
        return () => {
            active = false
        }
    }, [workspaceId, refreshKey])

    if (workspaceId === null) return NO_IDEAS
    return settled.get(workspaceId) ?? (loaded?.workspaceId === workspaceId ? loaded.ideas : NO_IDEAS)
}
