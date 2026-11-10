'use client'

import type { TableCard as TableCardData } from '@rerun/contracts'
import { TableCard as TableCardBase } from '@rerun/ui/chat'
import { rawUrlResolver, type RawUrlFor } from '@/lib/files/raw-url'
import { useBoardStore } from '@/stores/board.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useTranslations } from 'next-intl'

type TableCardProps = {
    /** Absent on read-only transcripts rendered outside a Box: the button then explains itself. */
    agentId?: string
    card: TableCardData
    /** Overridden by the design lab, which has no board to navigate. */
    onOpen?: () => void
    /** Where an image cell holding a workspace path loads from, when it is not the agent's own box. */
    rawUrlFor?: RawUrlFor
}

export function TableCard({ agentId, card, onOpen, rawUrlFor }: TableCardProps) {
    // The panels this button targets only exist on the board. Finding the agent in the board store
    // is what proves one is listening: outside it the agent is absent, and the button then explains
    // itself rather than doing nothing.
    const t = useTranslations('chat.tableCard')
    const boxId = useBoardStore(state => state.agents.find(a => a.id === agentId)?.spaceId)
    const openAgentData = useBoardStore(state => state.openAgentData)
    const openKnowledgeBase = useWorkspaceSettingsStore(state => state.openKnowledgeBase)

    function openTarget(): (() => void) | undefined {
        if (onOpen) return onOpen
        if (!boxId) return undefined
        if (card.scope === 'shared') return () => openKnowledgeBase('database', card.table, card.view)
        return agentId ? () => openAgentData(agentId, card.table, card.view) : undefined
    }

    const target = openTarget()
    const fileUrl = rawUrlResolver(agentId, rawUrlFor) ?? undefined

    return <TableCardBase card={card} onOpen={target} openDisabledReason={t('openDisabledReason')} fileUrl={fileUrl} />
}
