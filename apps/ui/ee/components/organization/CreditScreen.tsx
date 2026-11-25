'use client'

import { useTranslations } from 'next-intl'

import { allocateOrganizationCreditAction, listOrganizationWorkspacesAction, loadOrganizationCreditAction, takeBackOrganizationCreditAction } from '@/ee/actions/organization.actions'
import type { OrganizationCredit } from '@/ee/services/organization-credit.service'
import type { OrganizationWorkspaceSummary } from '@/ee/services/organization-workspaces.service'

import { consoleWorkspaceOf, mergeCreditHistory } from './console-data'
import { useWriteBlock } from './ConsoleProvider'
import { CreditView } from './CreditView'
import type { CreditTransfer } from './types'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'
import { useTakeBackNotice } from './useTakeBackNotice'

type Workspaces = { workspaces: OrganizationWorkspaceSummary[] }

export function CreditScreen({ initial, initialWorkspaces }: { initial: OrganizationCredit; initialWorkspaces: Workspaces }) {
    const t = useTranslations('organization.workspaces')
    const block = useWriteBlock()
    const { data, update, reload } = useConsoleData(initial, loadOrganizationCreditAction, { merge: mergeCreditHistory })
    const list = useConsoleData(initialWorkspaces, listOrganizationWorkspacesAction)
    const { submit } = useConsoleChange(() => Promise.all([reload(), list.reload()]))
    const history = useConsoleChange<'more'>(async () => {})
    const noticeTakeBack = useTakeBackNotice()

    const loadMore = () =>
        history.run('more', async () => {
            const result = await loadOrganizationCreditAction(data.nextBeforeSeq ?? undefined)
            if (result.ok) update(current => ({ ...current, movements: [...current.movements, ...result.movements.filter(movement => movement.seq < (current.movements.at(-1)?.seq ?? Infinity))], nextBeforeSeq: result.nextBeforeSeq }))
            return result
        })

    const takeBack = async (transfer: CreditTransfer) => {
        const result = await submit(() => takeBackOrganizationCreditAction(transfer))
        if (result.ok) noticeTakeBack(transfer, result.micros)
        return result
    }

    return (
        <CreditView
            reserveMicros={data.balanceMicros}
            workspaces={list.data.workspaces.map(workspace => consoleWorkspaceOf(workspace, t('unnamed')))}
            movements={data.movements}
            hasMore={data.nextBeforeSeq !== null}
            loadingMore={history.pending === 'more'}
            block={block}
            onLoadMore={loadMore}
            onAllocate={transfer => submit(() => allocateOrganizationCreditAction(transfer))}
            onTakeBack={takeBack}
        />
    )
}
