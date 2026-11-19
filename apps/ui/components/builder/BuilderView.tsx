'use client'

import { useCallback, useEffect, useState } from 'react'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { NewAgentDialog } from '@/components/dialogs/NewAgentDialog'
import { TemplateLibraryDialog } from '@/components/templates/TemplateLibraryDialog'
import { IsoBoard } from '@/components/builder/IsoBoard'
import { BuilderToolbar } from '@/components/builder/BuilderToolbar'
import { BoardCornerActions } from '@/components/layout/BoardCornerActions'
import { Stripes } from '@moldwright/ui/primitives'
import { getSharedTemplateAction } from '@/app/api/_actions/template.actions'
import { useLibraryViewerSignals } from '@/lib/templates/useLibraryViewerSignals'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { isAgentShareFlowBusy, useAgentShareStore } from '@/stores/agent-share.store'
import { isTemplateFlowBusy, useTemplateFlowStore } from '@/stores/template-flow.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useForemanStore } from '@/stores/foreman.store'
import type { SpacePublic } from '@/lib/board/types'

export function BuilderView({ initialSpaces = [] }: { initialSpaces?: SpacePublic[] }) {
    const { workspace } = useSession()
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [newAgentOpen, setNewAgentOpen] = useState(false)
    const [newAgentSpaceId, setNewAgentSpaceId] = useState<string | null>(null)
    const viewerSignals = useLibraryViewerSignals()

    const startRecruiting = useCallback(() => {
        if (!workspace?.onboarded_at) {
            useForemanStore.getState().openForFunnel()
            return
        }
        setLibraryOpen(true)
    }, [workspace?.onboarded_at])

    const recruitInBox = useCallback((spaceId: string) => {
        setNewAgentSpaceId(spaceId)
        setNewAgentOpen(true)
    }, [])

    const pendingTemplateLink = useOnboardingStore(s => s.pendingTemplateLink)
    useEffect(() => {
        if (!pendingTemplateLink) return
        void getSharedTemplateAction(pendingTemplateLink).then(found => {
            if (found) useTemplateFlowStore.getState().resolveLink(found)
        })
    }, [pendingTemplateLink])

    useEffect(() => {
        const unsubscribeTemplate = useTemplateFlowStore.subscribe(state => {
            if (isTemplateFlowBusy(state)) setLibraryOpen(false)
        })
        const unsubscribeShare = useAgentShareStore.subscribe(state => {
            if (isAgentShareFlowBusy(state)) setLibraryOpen(false)
        })
        return () => {
            unsubscribeTemplate()
            unsubscribeShare()
        }
    }, [])

    return (
        <>
            <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0)' }}>
                <IsoBoard onRequestRecruitAgent={startRecruiting} onRequestBoxAgent={recruitInBox} initialSpaces={initialSpaces} />
            </div>
            {workspace?.is_sandbox && <Stripes fade="edges" edgeWidth={104} color="rgb(245 158 11 / 0.16)" />}
            <BuilderToolbar />
            <BoardCornerActions />
            <AgentPanel />
            <TemplateLibraryDialog
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                priorityCategory={viewerSignals.category}
                preferredConnectorSlugs={viewerSignals.connectorSlugs}
                onCreateFromScratch={() => {
                    setLibraryOpen(false)
                    setNewAgentSpaceId(null)
                    setNewAgentOpen(true)
                }}
            />
            <NewAgentDialog
                open={newAgentOpen}
                spaceId={newAgentSpaceId}
                onOpenChange={setNewAgentOpen}
                onBrowseTemplates={() => {
                    setNewAgentOpen(false)
                    setLibraryOpen(true)
                }}
            />
        </>
    )
}
