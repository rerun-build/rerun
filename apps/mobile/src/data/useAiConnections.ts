import type { AiConnectionsView } from '@rerun/contracts'
import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'

import { fetchAiConnections } from '@/api/aiConnections'
import { useAuth } from '@/auth/AuthProvider'
import { cachedAiConnections } from '@/data/local-cache'
import { translatorFor } from '@/i18n/translator'

// Opens on the last list read for the workspace rather than on a skeleton, and settles once its own
// read lands.
export function useAiConnections() {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const caller = useMemo(() => (accessToken && workspaceId ? { accessToken, workspaceId } : null), [accessToken, workspaceId])
    const [view, setView] = useState<AiConnectionsView | null>(() => (workspaceId ? cachedAiConnections(workspaceId).read() : null))
    const [failed, setFailed] = useState(false)

    const reload = useCallback(async () => {
        if (!caller) return
        try {
            const next = await cachedAiConnections(caller.workspaceId).load(() => fetchAiConnections(caller))
            setView(next)
            setFailed(false)
        } catch {
            setFailed(true)
        }
    }, [caller])

    useFocusEffect(
        useCallback(() => {
            reload()
        }, [reload])
    )

    return { view, failed: failed && !view, caller, reload, setView }
}

export function messageOf(err: unknown, fallback?: string): string {
    return err instanceof Error && err.message ? err.message : (fallback ?? translatorFor('mobileCommon')('errors.generic'))
}
