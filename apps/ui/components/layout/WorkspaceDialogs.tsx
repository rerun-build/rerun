'use client'

import { BoxPickerDialog } from '@/components/dialogs/BoxPickerDialog'
import { ClaimSpaceDialog } from '@/components/dialogs/ClaimSpaceDialog'
import { NewAgentDialog } from '@/components/dialogs/NewAgentDialog'
import { ToolbarDialogs } from '@/components/layout/ToolbarActions'
import { TemplateLibraryDialog } from '@/components/templates/TemplateLibraryDialog'
import { MyTemplatesDialog } from '@/components/templates/expert/MyTemplatesDialog'
import { useIsTemplateAuthor } from '@/hooks/useIsTemplateAuthor'
import { useLibraryViewerSignals } from '@/lib/templates/useLibraryViewerSignals'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { useSession } from '@/supabase/session/SessionProvider'

/**
 * The dialogs any view of the workspace opens through a store (billing, notifications, shortcuts, a new
 * coworker, the template library, a new Box, the Box a creation joins): mounted once beside the view,
 * whichever it is. Radix portals them, so where they sit in the tree changes nothing on screen.
 */
export function WorkspaceDialogs() {
    const { isAnonymous } = useSession()
    const { libraryOpen, newAgentOpen, librarySlug, newBoxOpen, openLibrary, openNewAgent, setLibraryOpen, setNewAgentOpen, setNewBoxOpen } = useBuilderDialogsStore()
    const isTemplateAuthor = useIsTemplateAuthor()
    const viewerSignals = useLibraryViewerSignals()

    if (isAnonymous) return <ToolbarDialogs />

    return (
        <>
            <NewAgentDialog open={newAgentOpen} onOpenChange={setNewAgentOpen} onBrowseTemplates={openLibrary} />
            <TemplateLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} priorityCategory={viewerSignals.category} preferredConnectorSlugs={viewerSignals.connectorSlugs} initialSlug={librarySlug} onCreateFromScratch={openNewAgent} />
            <ClaimSpaceDialog target={null} open={newBoxOpen} onClose={() => setNewBoxOpen(false)} />
            <BoxPickerDialog />
            {isTemplateAuthor && <MyTemplatesDialog />}
            <ToolbarDialogs />
        </>
    )
}
