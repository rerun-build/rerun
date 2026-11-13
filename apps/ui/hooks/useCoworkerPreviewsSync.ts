'use client'

import { useEffect } from 'react'

import { useCoworkerPreviewsStore } from '@/stores/coworker-previews.store'

// Reads each coworker's latest conversation for the Simple view's list, again for each workspace
// opened. What changes after that arrives through the sessions channel (`useSessionsRealtime`).
export function useCoworkerPreviewsSync(workspaceId: number | undefined) {
    useEffect(() => {
        if (workspaceId) void useCoworkerPreviewsStore.getState().load(workspaceId)
        else useCoworkerPreviewsStore.getState().reset()
    }, [workspaceId])
}
