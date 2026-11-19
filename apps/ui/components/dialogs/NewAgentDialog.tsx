'use client'

import type { NewAgentRequest } from '@moldwright/ui/new-agent'
import { useTranslations } from 'next-intl'

import { readAgentJobAction } from '@/app/api/_actions/onboarding.actions'
import { NewAgentForm } from '@/components/dialogs/new-agent/NewAgentForm'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useCanManageSpace } from '@/hooks/useBoxAccess'
import { useConnectorCatalog } from '@/lib/new-agent/useConnectorCatalog'
import { useBoxAgentSuggestions } from '@/lib/onboarding/useBoxAgentSuggestions'
import { useStartScratchAgent } from '@/lib/templates/useStartScratchAgent'

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
