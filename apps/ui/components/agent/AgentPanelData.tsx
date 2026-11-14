'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { TableIcon } from '@/lib/icons'
import { deleteAgentTableRowsAction, dropAgentTableAction, listAgentTablesAction, purgeAgentTableAction, readAgentTableRowsAction } from '@/app/api/_actions/agent.actions'
import { DataBrowser } from '@/components/data/DataBrowser'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { tablesOrThrow, viewActions, type DataFocus, type DataSource } from '@/lib/data/source'
import { agentFileRawUrl } from '@/lib/files/raw-url'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { withTabWorkspace } from '@/lib/workspace/tab-workspace'

type AgentPanelDataProps = {
    agentId: string
    initial?: DataFocus | null
    onInitialConsumed?: () => void
}

export function AgentPanelData({ agentId, initial, onInitialConsumed }: AgentPanelDataProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelData')
    const [expanded, setExpanded] = useState<DataFocus | null>(null)
    const canManage = useCanManageAgent(agentId)
    const source = useMemo<DataSource>(
        () => ({
            scope: 'agent',
            storageKey: `agent:${agentId}`,
            listTables: () => listAgentTablesAction(agentId).then(tablesOrThrow),
            readRows: (table, params) => readAgentTableRowsAction(agentId, table, params),
            deleteRows: (table, rowids) => deleteAgentTableRowsAction(agentId, table, rowids),
            dropTable: table => dropAgentTableAction(agentId, table),
            purgeTable: table => purgeAgentTableAction(agentId, table),
            tableActionsReason: canManage ? undefined : boxManageReason,
            exportUrl: (table, params) => {
                const qs = new URLSearchParams({ agentId, table, format: params.format })
                if (params.sort) qs.set('sort', params.sort)
                if (params.dir) qs.set('dir', params.dir)
                if (params.q) qs.set('q', params.q)
                if (params.where?.length) qs.set('where', JSON.stringify(params.where))
                return withTabWorkspace(`/api/data/export?${qs.toString()}`)
            },
            ...viewActions({ kind: 'agent', agentId }),
            fileUrl: path => agentFileRawUrl(agentId, path),
            unreachableMessage: t('unreachable'),
            emptyTitle: t('emptyTitle'),
            emptyDescription: t('emptyDescription'),
        }),
        [agentId, canManage, t],
    )

    return (
        <>
            <DataBrowser source={source} initial={initial} onInitialConsumed={onInitialConsumed} onExpand={setExpanded} />
            {/* The panel is too narrow for a board or a gallery: the same table and view open here
                at full size, as a second browser that reads the same database. */}
            <Dialog open={expanded !== null} onOpenChange={open => !open && setExpanded(null)}>
                <PanelDialogContent className="sm:h-[92dvh] sm:max-w-[min(100rem,95vw)]">
                    <DialogHeaderBar icon={TableIcon} title={t('dialogTitle')} description={t('dialogDescription')} />
                    {expanded && <DataBrowser source={source} initial={expanded} />}
                </PanelDialogContent>
            </Dialog>
        </>
    )
}
