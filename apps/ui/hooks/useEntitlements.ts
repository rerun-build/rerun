'use client'

import { activeAgentLimitFor } from '@rerun/cloud/billing'
import { AGENT_LIMIT_TRIGGER, useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useMemo } from 'react'

export function useEntitlements() {
    const { workspace } = useSession()
    const activeAgentsCount = useBoardStore(s => s.agents.filter(a => !a.disabledAt).length)
    const openBilling = useBillingStore(s => s.openBilling)

    const maxAgents = workspace ? activeAgentLimitFor(workspace.max_agents, workspace.subscription_status) : null

    return useMemo(() => {
        return {
            activeAgentsCount,
            maxAgents,
            noFreeAgentSlot: maxAgents !== null && activeAgentsCount >= maxAgents,
            agentsRoomFor: (count: number): { ok: boolean } => {
                const total = useBoardStore.getState().agents.filter(a => !a.disabledAt).length + count
                return { ok: maxAgents === null || total <= maxAgents }
            },
            gate: () => openBilling(undefined, AGENT_LIMIT_TRIGGER),
        }
    }, [maxAgents, activeAgentsCount, openBilling])
}
