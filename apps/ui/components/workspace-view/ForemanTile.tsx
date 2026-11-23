'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { Orb } from '@/components/foreman/Orb'
import { useForemanAsAgent } from '@/components/foreman/ForemanCard'
import { CoworkerTile, type CoworkerTileActions } from '@/components/workspace-view/CoworkerTile'
import { useForemanInCenter } from '@/components/workspace-view/useForemanInCenter'
import { useCoworkerPreviewsStore } from '@/stores/coworker-previews.store'
import { foremanOrbState, selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// Its row in the database, which the line under it is read by: the app calls it by its name.
function useForemanRowId(): string | null {
    const workspaceId = useSession().workspace?.id
    const [rowId, setRowId] = useState<string | null>(null)
    useEffect(() => {
        if (!workspaceId) return
        let alive = true
        void selectMaybeSingle(createClient(), 'agents', ['id'] as const, { workspace_id: workspaceId, kind: 'foreman' }).then(({ data }) => {
            if (alive) setRowId(data?.id ?? null)
        })
        return () => {
            alive = false
        }
    }, [workspaceId])
    return rowId
}

const ACTIONS: CoworkerTileActions = {
    onNewConversation: () => {
        const store = useForemanStore.getState()
        store.openInCenter()
        store.newChat()
    },
    onOpenCard: () => {
        useForemanStore.getState().openInCenter()
        useSimpleDetailsStore.getState().setWanted(true)
    },
}

/** The Chief of Staff at the top of the list, in place of the orb that floats over the board: a coworker's tile, with its orb. */
export function ForemanTile() {
    const tView = useTranslations('workspaceView.foreman')
    const base = useForemanAsAgent()
    const visible = useForemanStore(selectForemanVisible)
    const open = useForemanInCenter()
    const activity = useForemanStore(s => s.activity)
    const viewerId = useSession().user?.id ?? null
    const rowId = useForemanRowId()
    const preview = useCoworkerPreviewsStore(s => (rowId ? s.byAgent[rowId] : undefined))
    // Its line until it has said something: what it is for.
    const agent = useMemo(() => ({ ...base, description: tView('line'), status: activity === 'idle' ? ('idle' as const) : ('working' as const) }), [base, tView, activity])
    if (!visible) return null

    return (
        <CoworkerTile
            agent={agent}
            preview={preview}
            viewerId={viewerId}
            selected={open}
            unseen={false}
            onOpen={() => useForemanStore.getState().openInCenter()}
            actions={ACTIONS}
            avatar={size => <Orb size={size - 6} state={foremanOrbState({ open, activity })} facing="right" />}
        />
    )
}
