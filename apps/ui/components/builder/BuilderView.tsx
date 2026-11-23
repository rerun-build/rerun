'use client'

import { useCallback, useEffect, useState } from 'react'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { NewAgentDialog } from '@/components/dialogs/NewAgentDialog'
import { TemplateLibraryDialog } from '@/components/templates/TemplateLibraryDialog'
import { IsoBoard } from '@/components/builder/IsoBoard'
import { BuilderToolbar } from '@/components/builder/BuilderToolbar'
import { BoardCornerActions } from '@/components/layout/BoardCornerActions'
import { Stripes } from '@rerun/ui/primitives'
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
    // The library a first agent is recruited from has its own way out to the agent with no template.
    const [newAgentOpen, setNewAgentOpen] = useState(false)
    // The Box the dialog was opened from, which the agent then lands in.
    const [newAgentSpaceId, setNewAgentSpaceId] = useState<string | null>(null)
    const viewerSignals = useLibraryViewerSignals()

    // Recruiting the first agent. A workspace that has never been onboarded is met by the foreman,
    // which does the whole thing in conversation; everyone else goes straight to the library, on the
    // industry and the apps the workspace's profile already carries.
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

    // Un lien de template sur un compte qui n'a jamais fait l'onboarding : la fiche ne s'ouvre pas
    // d'elle-même, c'est le Foreman qui reprend le lien et en fait le début de la conversation. On
    // précharge quand même, pour que la fiche s'ouvre sans son skeleton quand il y envoie.
    const pendingTemplateLink = useOnboardingStore(s => s.pendingTemplateLink)
    useEffect(() => {
        if (!pendingTemplateLink) return
        void getSharedTemplateAction(pendingTemplateLink).then(found => {
            if (found) useTemplateFlowStore.getState().resolveLink(found)
        })
    }, [pendingTemplateLink])

    // Une seule dialog d'installation à la fois, et c'est la fiche d'une template (lien partagé,
    // retour de checkout) qui gagne : elle est la seule à porter une intention explicite. On ferme
    // plutôt qu'on ne masque, sinon la library ressurgirait dès que la fiche se referme.
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
            {/* La grille est isolée sur son propre layer GPU (translateZ) : ses pixels sont mis en
                cache comme une texture, donc le scroll du chat (autre layer) ne la fait plus
                repeindre. C'est ce qui supprime le "tout l'écran repeint au scroll". */}
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
