'use client'

import { getAgentKeysAction, updateAgentKeysAction } from '@/app/api/_actions/agent.actions'
import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useMemo, useState } from 'react'

export type AgentVariableSource = 'agent' | 'engine' | null

export type AgentVariables = {
    has: (name: string) => boolean
    source: (name: string) => AgentVariableSource
    save: (name: string, value: string) => Promise<string | null>
    remove: (name: string) => Promise<string | null>
    markDefined: (names: string[]) => void
}

// The engine only ever hands back key names, never values (GET /agents/:id/keys), so a variable is
// write-only from here: the UI can say whether one is set and replace it, never reveal it.
// `engineKeys` are the RERUN_* names the engine resolves from its own process env: they count as
// defined too, and an agent-level save overrides them (the resolver reads the agent env first).
export function useAgentVariables(agentId: string): AgentVariables {
    const errorText = useErrorText()
    const [agentKeys, setAgentKeys] = useState<string[]>([])
    const [engineKeys, setEngineKeys] = useState<string[]>([])

    const refresh = useCallback(async () => {
        const result = await getAgentKeysAction(agentId)
        setAgentKeys(result.keys)
        setEngineKeys(result.engineKeys)
    }, [agentId])

    useEffect(() => {
        refresh()
    }, [refresh])

    const apply = useCallback(
        async (body: { set?: Record<string, string>; remove?: string[] }): Promise<string | null> => {
            const result = await updateAgentKeysAction(agentId, body)
            if (!result.success) return errorText(result)
            await refresh()
            return null
        },
        [agentId, refresh, errorText],
    )

    const save = useCallback((name: string, value: string) => apply({ set: { [name]: value } }), [apply])
    const remove = useCallback((name: string) => apply({ remove: [name] }), [apply])
    const source = useCallback<(name: string) => AgentVariableSource>(name => (agentKeys.includes(name) ? 'agent' : engineKeys.includes(name) ? 'engine' : null), [agentKeys, engineKeys])
    const has = useCallback((name: string) => source(name) !== null, [source])
    const markDefined = useCallback((names: string[]) => setAgentKeys(prev => [...new Set([...prev, ...names])].sort()), [])

    return useMemo(() => ({ has, source, save, remove, markDefined }), [has, source, save, remove, markDefined])
}
