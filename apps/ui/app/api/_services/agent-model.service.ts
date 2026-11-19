import 'server-only'
import { actorFromContext, type AccessLevel } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveAgentTarget, resolveRunTarget } from '@/app/api/_services/chat.service'
import { assertModelEntitled } from '@/app/api/_services/engine-plan.service'
import { ApiError } from '@/lib/api-error'
import { isPremiumModelEntitled } from '@moldwright/cloud/billing'
import { getAgent as engineGetAgent, listConnections, patchAgent as enginePatchAgent } from '@/lib/engine/client'
import { connectionGroups } from '@/lib/engine/model-groups'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { FOREMAN_AGENT_ID, type AgentModels, type ModelChoice, type SetAgentModelInput } from '@moldwright/contracts'

const targetOf = (ctx: WorkspaceContext, agentId: string, access: AccessLevel) => (agentId === FOREMAN_AGENT_ID ? resolveRunTarget(agentId) : resolveAgentTarget(agentId, actorFromContext(ctx), access))

const choiceOf = (connectionId: string | null | undefined, model: string | null | undefined): ModelChoice | null => (connectionId && model ? { connectionId, model } : null)

export async function readAgentModels(ctx: WorkspaceContext, agentId: string): Promise<AgentModels> {
    const { conn, engineAgentId } = await targetOf(ctx, agentId, 'use')
    const [detail, list, t] = await Promise.all([
        engineGetAgent(conn, engineAgentId),
        listConnections(conn),
        recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id).then(locale => translatorFor(locale, 'connections')),
    ])
    const groups = connectionGroups(list.connections, isPremiumModelEntitled(ctx.workspace), t)
    return {
        groups: groups.map(group => ({
            connectionId: group.connectionId,
            label: group.label,
            provider: group.provider,
            defaultModel: group.defaultModel,
            models: group.models.map(model => ({ id: model.id, label: model.label, description: model.description, locked: model.locked })),
        })),
        pinned: choiceOf(detail.config.connectionId, detail.config.model),
        resolved: choiceOf(detail.resolvedConnectionId, detail.resolvedModel),
        boxDefault: list.default ?? (groups[0] ? { connectionId: groups[0].connectionId, model: groups[0].defaultModel } : null),
    }
}

export async function setAgentModel(ctx: WorkspaceContext, agentId: string, choice: SetAgentModelInput): Promise<void> {
    const { conn, engineAgentId } = await targetOf(ctx, agentId, 'manage')
    if (choice.model === null) {
        await enginePatchAgent(conn, engineAgentId, { connectionId: null, provider: null, model: null })
        return
    }
    await assertModelEntitled(choice.model, ctx.workspace.id)
    const connection = (await listConnections(conn)).connections.find(entry => entry.id === choice.connectionId && entry.connected)
    if (!connection) throw new ApiError(400, 'This connection is not available on the machine')
    await enginePatchAgent(conn, engineAgentId, { connectionId: connection.id, provider: connection.provider, model: choice.model })
}
