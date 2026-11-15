'use client'

import type { TableCard as TableCardData } from '@rerun/contracts'
import { TableCard as TableCardBase } from '@rerun/ui/chat'
import { rawUrlResolver, type RawUrlFor } from '@/lib/files/raw-url'
import { useBoardStore } from '@/stores/board.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useTranslations } from 'next-intl'

type TableCardProps = {
    agentId?: string
    card: TableCardData
    onOpen?: () => void
    rawUrlFor?: RawUrlFor
}

export function TableCard({ agentId, card, onOpen, rawUrlFor }: TableCardProps) {
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
