'use client'

import { useTranslations } from 'next-intl'

import { useBoardStore } from '@/stores/board.store'

import type { AgentPick } from './agent-picks'
import { AgentPickerList, type AgentPickerRow } from './AgentPickerList'

type PickRow = AgentPickerRow & { pick: AgentPick }

// Opening the chat tab alone lands on a blank composer: the panel keeps one conversation per tab
// and starts a fresh one when nothing says otherwise. A run already started for this agent has to
// be named, or the user watches an empty chat while it works next door.
export function openAgentPick({ agentId, tab, conversationId, runId }: AgentPick) {
    const board = useBoardStore.getState()
    board.focusAgentOnBoard(agentId, tab ?? undefined)
    if (tab === 'chat' && conversationId) board.setPendingOpenSession({ agentId, sessionId: conversationId, runId })
}

// Names are read off the live board rather than the model's arguments: the card cannot print an
// agent the model made up, and one deleted since simply drops out.
export function AgentPickerCard({ picks }: { picks: AgentPick[] }) {
    const t = useTranslations('foreman.agentTabs')
    const agents = useBoardStore(s => s.agents)
    const selectedId = useBoardStore(s => s.selectedAgentId)

    const rows = picks.flatMap((pick): PickRow[] => {
        const agent = agents.find(entry => entry.id === pick.agentId)
        return agent ? [{ id: agent.id, name: agent.name, disabled: !!agent.disabledAt, tab: pick.tab ? t(pick.tab) : undefined, pick }] : []
    })

    return <AgentPickerList rows={rows} selectedId={selectedId} onPick={row => openAgentPick(row.pick)} />
}
