'use client'

import type { NewAgentRequest } from '@rerun/ui/new-agent'
import { useTranslations } from 'next-intl'

import { readAgentJobAction } from '@/app/api/_actions/onboarding.actions'
import { NewAgentForm } from '@/components/dialogs/new-agent/NewAgentForm'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useCanManageSpace } from '@/hooks/useBoxAccess'
import { useConnectorCatalog } from '@/lib/new-agent/useConnectorCatalog'
import { useBoxAgentSuggestions } from '@/lib/onboarding/useBoxAgentSuggestions'
import { useStartScratchAgent } from '@/lib/templates/useStartScratchAgent'

// The agent described in one sentence: Rerun reads its name, its apps and its timing in it. The
// dialog writes nothing and calls no action to create anything: the agent is created on the tile
// drop, with its apps, and the description is its first message.
//
// One column rather than the house form and aside: the description is the whole dialog, and the
// templates the aside used to carry are one button under it. The frame keeps the house size.
//
// Opened from an empty Box, it carries that Box: the suggestions are the ones that belong there, and
// the agent can only be dropped in it. A Box the caller only uses keeps its suggestions but is no
// destination: the drop then goes to one they manage.
export function NewAgentDialog({ open, onOpenChange, onBrowseTemplates, spaceId = null }: { open: boolean; onOpenChange: (open: boolean) => void; onBrowseTemplates: (slug?: string) => void; spaceId?: string | null }) {
    const t = useTranslations('dialogs.newAgent')
    const startScratchAgent = useStartScratchAgent()
    const { suggestions, heading } = useBoxAgentSuggestions(spaceId, open)
    const catalog = useConnectorCatalog(open)
    const destination = useCanManageSpace(spaceId) ? spaceId : null

    function create(agent: NewAgentRequest) {
        startScratchAgent(agent, destination)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <SplitDialogContent aside={null} gridClassName="sm:grid-cols-1">
                <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                <DialogDescription className="sr-only">{t('description')}</DialogDescription>
                <NewAgentForm suggestions={suggestions} suggestionsHeading={heading} catalog={catalog} read={readAgentJobAction} onCreate={create} onBrowseTemplates={() => onBrowseTemplates()} />
            </SplitDialogContent>
        </Dialog>
    )
}
