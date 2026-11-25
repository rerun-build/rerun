'use client'

import { allocateOrganizationCreditAction, loadOrganizationCreditAction, takeBackOrganizationCreditAction } from '@/ee/actions/organization.actions'
import type { OrganizationCredit } from '@/ee/services/organization-credit.service'

import { attempt } from './attempt'
import { mergeCreditHistory } from './console-data'
import { useConsole, useWriteBlock } from './ConsoleProvider'
import { CreditView } from './CreditView'
import type { ConsoleRefusal, CreditTransfer } from './types'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'
import { useTakeBackNotice } from './useTakeBackNotice'

export function CreditScreen({ initial }: { initial: OrganizationCredit }) {
    const block = useWriteBlock()
    const { workspaces, reserveMicros, reload: reloadConsole } = useConsole()
    const { data, update, reload } = useConsoleData(initial, loadOrganizationCreditAction, { merge: mergeCreditHistory })
    const { submit } = useConsoleChange(() => Promise.all([reload(), reloadConsole()]))
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

    // One after the other: they all leave the same reserve. The page is read again once, at the end.
    const give = async (transfers: CreditTransfer[]) => {
        const refusals = new Map<number, ConsoleRefusal>()
        await submit(async () => {
            for (const transfer of transfers) {
                const result = await attempt(() => allocateOrganizationCreditAction(transfer))
                if (!result.ok) refusals.set(transfer.workspaceId, result)
            }
            return refusals.size < transfers.length ? { ok: true as const } : [...refusals.values()][0]
        })
        return refusals
    }

    return <CreditView reserveMicros={reserveMicros} workspaces={workspaces} movements={data.movements} hasMore={data.nextBeforeSeq !== null} loadingMore={history.pending === 'more'} block={block} onLoadMore={loadMore} onGive={give} onTakeBack={takeBack} />
}
