'use client'

import { updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { patchAgentModel, useAgentContext } from '@/hooks/useAgentContext'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { isPremiumModelEntitled } from '@rerun/cloud/billing'
import type { BoxDefault } from '@/lib/engine/types'
import type { EngineProvider } from '@/lib/engine/types'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo } from 'react'
import { connectionGroups, type ConnectionGroup } from '@/lib/engine/model-groups'

export type { ConnectionGroup } from '@/lib/engine/model-groups'

export function useAvailableModels(agentId: string) {
    const { context, loaded } = useAgentContext(agentId)
    const { connections, boxDefault, loading: connectionsLoading, refresh: refreshConnections } = useWorkspaceConnections()
    const { workspace } = useSession()
    const tConnections = useTranslations('connections')
    // Unknown until the workspace is there, and unlocked meanwhile: a lock that flashes on a paying
    // account for the time of a hydration reads as a plan that was lost.
    const premiumAllowed = !workspace || isPremiumModelEntitled(workspace)

    const agentModel = context?.model
    const pin = { connectionId: agentModel?.connectionId ?? null, model: agentModel?.model ?? null }
    const resolved = { connectionId: agentModel?.resolvedConnectionId ?? null, model: agentModel?.resolvedModel ?? null }
    // An engine older than Box defaults answers no resolved model, and would reject a
    // `model: null` patch. Offering the entry would hand the user a dead button.
    const supportsBoxDefault = !!agentModel?.loaded && agentModel.resolvedModel !== null

    // A read of the agent that failed leaves every field null, which reads exactly like an agent
    // following the Box: the picker would repair a state it does not know. It waits for a read.
    const loading = !loaded || connectionsLoading || !agentModel?.loaded

    const availableGroups = useMemo(() => connectionGroups(connections, premiumAllowed, tConnections), [connections, premiumAllowed, tConnections])
    // The connection owning a model id. Ambiguous by construction — two Claude subscriptions both
    // serve `opus` — so the agent's own connection wins when it is one of the candidates.
    const connectionOf = useCallback(
        (model: string | null | undefined, preferred?: string | null): ConnectionGroup | undefined => {
            if (!model) return undefined
            const candidates = availableGroups.filter(group => group.models.some(m => m.id === model))
            return candidates.find(group => group.connectionId === preferred) ?? candidates[0]
        },
        [availableGroups]
    )

    // The pair the engine falls back to for every agent that picked nothing. Taken from the Box
    // rather than from this agent's resolution, so the entry reads the same in every picker.
    const boxDefaultPick: BoxDefault | null = useMemo(() => {
        if (boxDefault) return boxDefault
        const group = availableGroups[0]
        return group ? { connectionId: group.connectionId, model: group.defaultModel } : null
    }, [boxDefault, availableGroups])

    const setDefault = useCallback(
        (connectionId: string, model: string, provider: EngineProvider) => {
            patchAgentModel(agentId, { connectionId, model, resolvedConnectionId: connectionId, resolvedModel: model })
            void updateAgentConfigAction(agentId, { connectionId, model, provider })
        },
        [agentId]
    )

    // Back to following the Box. All three fields go, even though a null model is what the engine
    // switches on: a leftover connectionId would still show up in a connection's usage.
    const followBoxDefault = useCallback(() => {
        patchAgentModel(agentId, { connectionId: null, model: null, resolvedConnectionId: boxDefaultPick?.connectionId ?? null, resolvedModel: boxDefaultPick?.model ?? null })
        void updateAgentConfigAction(agentId, { connectionId: null, provider: null, model: null })
    }, [agentId, boxDefaultPick])

    return {
        availableGroups,
        connectionOf,
        // What the agent pinned: null on both means it follows the Box.
        pinnedModel: pin.model,
        pinnedConnectionId: pin.connectionId,
        // What it actually runs on today, pin or Box default.
        resolvedModel: resolved.model,
        resolvedConnectionId: resolved.connectionId,
        followsBoxDefault: pin.model === null,
        supportsBoxDefault,
        boxDefaultPick,
        setDefault,
        followBoxDefault,
        refreshConnections,
        loading,
    }
}
