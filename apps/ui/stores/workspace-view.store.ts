import { track } from '@rerun/analytics/client'
import { create } from 'zustand'

import { loadWorkspaceView, rememberWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'

type WorkspaceViewState = {
    // Null until this browser's choice is read: the cookie the server rendered with stands in until then.
    preference: WorkspaceView | null
    restore: () => void
    choose: (view: WorkspaceView) => void
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set, get) => ({
    preference: null,
    restore: () => {
        const stored = loadWorkspaceView()
        if (stored) set({ preference: stored })
    },
    choose: view => {
        if (get().preference === view) return
        rememberWorkspaceView(view)
        set({ preference: view })
        track('workspace_view_switched', { view })
    },
}))
