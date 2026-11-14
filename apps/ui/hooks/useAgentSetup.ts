'use client'

import { activateAgentAutomationsAction } from '@/app/api/_actions/agent.actions'
import { invalidateAgentContext, useAgentContext } from '@/hooks/useAgentContext'
import { useCallback, useState } from 'react'

export type AgentSetupState = { pending: boolean; prompt: string; skipped: boolean; sessionId: string | null }

const skipKey = (agentId: string) => `setup-skipped-${agentId}`

function readSkipped(agentId: string): boolean {
    try {
        return localStorage.getItem(skipKey(agentId)) === '1'
    } catch {
        return false
    }
}

export function useAgentSetup(agentId: string): AgentSetupState & { refresh: () => void; skip: () => void; unskip: () => void } {
    const setup = useAgentContext(agentId).context?.setup ?? null
    const [skipChoice, setSkipChoice] = useState<{ agentId: string; skipped: boolean } | null>(null)

    const pending = setup !== null && setup.required === true && setup.completedAt === null && setup.prompt.trim().length > 0
    const skipped = pending && (skipChoice?.agentId === agentId ? skipChoice.skipped : readSkipped(agentId))

    const refresh = useCallback(() => {
        if (pending) invalidateAgentContext(agentId)
    }, [agentId, pending])

    const skip = useCallback(() => {
        try {
            localStorage.setItem(skipKey(agentId), '1')
        } catch {}
        setSkipChoice({ agentId, skipped: true })
        void activateAgentAutomationsAction(agentId)
    }, [agentId])

    const unskip = useCallback(() => {
        try {
            localStorage.removeItem(skipKey(agentId))
        } catch {}
        setSkipChoice({ agentId, skipped: false })
    }, [agentId])

    return { pending, prompt: setup?.prompt ?? '', skipped, sessionId: pending ? (setup?.sessionId ?? null) : null, refresh, skip, unskip }
}
