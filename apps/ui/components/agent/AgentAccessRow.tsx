'use client'

import { coworkerAccessSummary } from '@/components/agent/access-summary'
import { BOX_ACCESS_ADMIN_ONLY } from '@/components/dialogs/access-person'
import { BoxAccessDialog } from '@/components/dialogs/BoxAccessDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PanelRow } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useAgentAccess } from '@/hooks/useBoxAccess'
import type { IsoAgent } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

// Access is read from the coworker and set on its Box: the row only says who reaches it.
export function AgentAccessRow({ agent }: { agent: Pick<IsoAgent, 'id' | 'spaceId'> }) {
    const t = useTranslations('agent')
    const tSummary = useTranslations('agent.accessSummary')
    const isAdmin = useIsWorkspaceAdmin()
    const access = useAgentAccess(agent.id)
    const space = useBoardStore(s => s.spaces.find(candidate => candidate.id === agent.spaceId))
    const grantCount = useBoardStore(s => s.spaceGrants.filter(grant => grant.space_id === agent.spaceId).length)
    const [dialogOpen, setDialogOpen] = useState(false)

    if (!space) return null

    const { title, detail } = coworkerAccessSummary({ isAdmin, visibility: space.visibility, access, grantCount, boxName: space.name || t('untitledBox') }, tSummary)

    return (
        <Field label={t('agentAccessRow.label')}>
            <PanelRow
                title={title}
                description={detail}
                actions={
                    <TooltipDisabledReason reason={isAdmin ? undefined : BOX_ACCESS_ADMIN_ONLY}>
                        <Button type="button" size="sm" variant="outline" disabled={!isAdmin} onClick={() => setDialogOpen(true)}>
                            {t('agentAccessRow.manage')}
                        </Button>
                    </TooltipDisabledReason>
                }
            />
            {isAdmin && <BoxAccessDialog spaceId={space.id} boxName={space.name} open={dialogOpen} onOpenChange={setDialogOpen} />}
        </Field>
    )
}
