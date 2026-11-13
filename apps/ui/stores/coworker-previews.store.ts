import { create } from 'zustand'

import type { Database } from '@/app/api/database.types'
import type { SessionStatus } from '@/lib/board/types'
import { createClient } from '@/supabase/client'

type SessionRow = Database['public']['Tables']['sessions']['Row']

// A coworker's most recent conversation, what its tile in the Simple view's list is written from.
// `lastMessage` is null in a conversation older than the column, or before anyone spoke in it.
export type CoworkerPreview = {
    sessionId: string
    title: string
    status: SessionStatus
    updatedAt: string
    lastMessage: { text: string; from: 'user' | 'agent'; authorId: string | null } | null
}

type CoworkerPreviewsState = {
    workspaceId: number | null
    byAgent: Record<string, CoworkerPreview>
    loaded: boolean
    load: (workspaceId: number) => Promise<void>
    reload: () => Promise<void>
    applySession: (row: Pick<SessionRow, 'id' | 'agent_id' | 'title' | 'status' | 'updated_at' | 'last_message' | 'last_message_from' | 'last_message_author_id'>) => void
    reset: () => void
}

type PreviewFields = { title: string | null; status: SessionStatus | null; updated_at: string | null; last_message: string | null; last_message_from: string | null; last_message_author_id: string | null }

function previewOf(sessionId: string | null, row: PreviewFields): CoworkerPreview | null {
    if (!sessionId || !row.updated_at || !row.status) return null
    const from: 'user' | 'agent' | null = row.last_message_from === 'user' || row.last_message_from === 'agent' ? row.last_message_from : null
    const lastMessage = row.last_message && from ? { text: row.last_message, from, authorId: row.last_message_author_id } : null
    return { sessionId, title: row.title ?? '', status: row.status, updatedAt: row.updated_at, lastMessage }
}

// Parsed rather than compared as text: the sessions channel and PostgREST do not write timestamps alike.
const isNewer = (candidate: CoworkerPreview, current: CoworkerPreview | undefined) => !current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)

export const useCoworkerPreviewsStore = create<CoworkerPreviewsState>((set, get) => ({
    workspaceId: null,
    byAgent: {},
    loaded: false,

    // One row per coworker, read in the database: bounded however many conversations the workspace keeps.
    load: async workspaceId => {
        if (get().workspaceId !== workspaceId) set({ workspaceId, byAgent: {}, loaded: false })
        const { data, error } = await createClient().rpc('coworker_previews', { p_workspace_id: workspaceId })
        // Another workspace was opened while this one was read.
        if (get().workspaceId !== workspaceId) return
        // A failed read keeps what was there, and the list shows its coworkers without their line.
        if (error || !data) {
            set({ loaded: true })
            return
        }
        set(state => {
            // A row the sessions channel delivered during the read is newer than the read itself.
            const byAgent = { ...state.byAgent }
            for (const row of data) {
                const preview = previewOf(row.session_id, row)
                if (preview && isNewer(preview, byAgent[row.agent_id])) byAgent[row.agent_id] = preview
            }
            return { byAgent, loaded: true }
        })
    },

    reload: async () => {
        const { workspaceId } = get()
        if (workspaceId !== null) await get().load(workspaceId)
    },

    applySession: row => {
        if (get().workspaceId === null) return
        const preview = previewOf(row.id, row)
        if (!preview || !isNewer(preview, get().byAgent[row.agent_id])) return
        set(state => ({ byAgent: { ...state.byAgent, [row.agent_id]: preview } }))
    },

    reset: () => set({ workspaceId: null, byAgent: {}, loaded: false }),
}))
