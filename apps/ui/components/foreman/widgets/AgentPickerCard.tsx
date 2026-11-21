'use client'

import { useTranslations } from 'next-intl'

import { isConversationId } from '@/lib/chat/conversation-id'
import { useBoardStore } from '@/stores/board.store'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import type { AgentPick } from './agent-picks'
import { AgentPickerList, type AgentPickerRow } from './AgentPickerList'

type PickRow = AgentPickerRow & { pick: AgentPick }

// Opening the chat tab alone lands on a blank composer: the panel keeps one conversation per tab
// and starts a fresh one when nothing says otherwise. A run already started for this agent has to
// be named, or the user watches an empty chat while it works next door.
export function openAgentPick({ agentId, tab, conversationId, runId }: AgentPick) {
    const board = useBoardStore.getState()
    board.focusAgentOnBoard(agentId, tab ?? undefined)
    if (tab !== 'chat' || !conversationId) return
    if (isConversationId(conversationId)) {
        board.setPendingOpenSession({ agentId, sessionId: conversationId, runId })
        return
    }
    // The model handed the engine's session id rather than the conversation's: opened as is, every
    // message in that chat fails. Its row is found by that id; with none, the chat stays on the tab.
    void selectMaybeSingle(createClient(), 'sessions', ['id'] as const, { agent_id: agentId, engine_session_id: conversationId }).then(({ data, error }) => {
        if (error) console.warn(`[FOREMAN PICK] agent=${agentId} session=${conversationId} could not be looked up:`, error)
        // The answer can come back after the user went on to another coworker: opened then, it would
        // pull them back to this one's chat.
        const current = useBoardStore.getState()
        if (data && current.selectedAgentId === agentId) current.setPendingOpenSession({ agentId, sessionId: data.id, runId })
    })
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
