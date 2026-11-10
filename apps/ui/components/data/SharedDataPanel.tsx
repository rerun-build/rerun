'use client'

import { deleteWorkspaceTableRowsAction, dropWorkspaceTableAction, listWorkspaceTablesAction, purgeWorkspaceTableAction, readWorkspaceTableRowsAction } from '@/app/api/_actions/workspace-db.actions'
import { DataBrowser } from '@/components/data/DataBrowser'
import { tablesOrThrow, viewActions, type DataFocus, type DataSource } from '@/lib/data/source'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { withTabWorkspace } from '@/lib/workspace/tab-workspace'

export function useSharedTablesEmpty() {
    const t = useTranslations('data.shared')
    return { title: t('emptyTitle'), description: t('emptyDescription') }
}

type SharedDataPanelProps = {
    initial?: DataFocus | null
    onInitialConsumed?: () => void
    table?: string
    onTableDropped?: () => void
}

// The database every agent of the workspace reads and writes, as opposed to the private one each
// agent keeps to itself.
export function SharedDataPanel({ initial, onInitialConsumed, table, onTableDropped }: SharedDataPanelProps) {
    const t = useTranslations('data.shared')
    const { title: emptyTitle, description: emptyDescription } = useSharedTablesEmpty()
    const unreachableMessage = t('unreachable')
    const source = useMemo<DataSource>(
        () => ({
            scope: 'shared',
            storageKey: 'shared',
            listTables: () => listWorkspaceTablesAction().then(tablesOrThrow),
            readRows: (table, params) => readWorkspaceTableRowsAction(table, params),
            deleteRows: (table, rowids) => deleteWorkspaceTableRowsAction(table, rowids),
            dropTable: table => dropWorkspaceTableAction(table),
            purgeTable: table => purgeWorkspaceTableAction(table),
            exportUrl: (table, params) => {
                const qs = new URLSearchParams({ scope: 'shared', table, format: params.format })
                if (params.sort) qs.set('sort', params.sort)
                if (params.dir) qs.set('dir', params.dir)
                if (params.q) qs.set('q', params.q)
                if (params.where?.length) qs.set('where', JSON.stringify(params.where))
                return withTabWorkspace(`/api/data/export?${qs.toString()}`)
            },
            ...viewActions({ kind: 'shared' }),
            unreachableMessage,
            emptyTitle,
            emptyDescription,
        }),
        [unreachableMessage, emptyTitle, emptyDescription]
    )

    return <DataBrowser source={source} initial={initial} onInitialConsumed={onInitialConsumed} table={table} onTableDropped={onTableDropped} />
}
