'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'

import { useSimpleViewEnabled } from '@/components/layout/FeatureFlagsProvider'
import { resolveWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useWorkspaceViewStore } from '@/stores/workspace-view.store'
import { useSession } from '@/supabase/session/SessionProvider'

// What the cookie said on the server: the preference until this browser's own is read.
const InitialViewContext = createContext<WorkspaceView | null>(null)

export function WorkspaceViewProvider({ initialView, children }: { initialView: WorkspaceView | null; children: ReactNode }) {
    useEffect(() => {
        useWorkspaceViewStore.getState().restore()
    }, [])
    return <InitialViewContext.Provider value={initialView}>{children}</InitialViewContext.Provider>
}

export function useWorkspaceViewPreference(): WorkspaceView | null {
    const chosen = useWorkspaceViewStore(s => s.preference)
    const initial = useContext(InitialViewContext)
    return chosen ?? initial
}

/** The frame the workspace is drawn in right now, and whether this account may switch at all. */
export function useWorkspaceView(): { view: WorkspaceView; enabled: boolean } {
    const enabled = useSimpleViewEnabled()
    const preference = useWorkspaceViewPreference()
    const { workspace, isAnonymous } = useSession()
    const guided = useForemanStore(s => s.funnel === 'guided')
    const waitlisted = useForemanStore(s => s.waitlisted)
    const placing = useBoardStore(s => s.placement !== null || s.placingAgentId !== null)
    const boxless = useBoardStore(s => s.hydrated && s.spaces.length === 0)
    const onboarding = guided || (!!workspace && !workspace.onboarded_at && !workspace.is_sandbox)
    const view = resolveWorkspaceView({ enabled, preference, anonymous: isAnonymous, onboarding, waitlisted, placing, boxless })
    return { view, enabled }
}
