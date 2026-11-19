'use client'

import { updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { patchAgentModel, useAgentContext } from '@/hooks/useAgentContext'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { isPremiumModelEntitled } from '@moldwright/cloud/billing'
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
    const premiumAllowed = !workspace || isPremiumModelEntitled(workspace)

    const agentModel = context?.model
    const pin = { connectionId: agentModel?.connectionId ?? null, model: agentModel?.model ?? null }
    const resolved = { connectionId: agentModel?.resolvedConnectionId ?? null, model: agentModel?.resolvedModel ?? null }
    const supportsBoxDefault = !!agentModel?.loaded && agentModel.resolvedModel !== null

    const loading = !loaded || connectionsLoading || !agentModel?.loaded

    const availableGroups = useMemo(() => connectionGroups(connections, premiumAllowed, tConnections), [connections, premiumAllowed, tConnections])
    const connectionOf = useCallback(
        (model: string | null | undefined, preferred?: string | null): ConnectionGroup | undefined => {
            if (!model) return undefined
            const candidates = availableGroups.filter(group => group.models.some(m => m.id === model))
            return candidates.find(group => group.connectionId === preferred) ?? candidates[0]
        },
        [availableGroups]
    )

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

    const followBoxDefault = useCallback(() => {
        patchAgentModel(agentId, { connectionId: null, model: null, resolvedConnectionId: boxDefaultPick?.connectionId ?? null, resolvedModel: boxDefaultPick?.model ?? null })
        void updateAgentConfigAction(agentId, { connectionId: null, provider: null, model: null })
    }, [agentId, boxDefaultPick])

    return {
        availableGroups,
        connectionOf,
        pinnedModel: pin.model,
        pinnedConnectionId: pin.connectionId,
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
