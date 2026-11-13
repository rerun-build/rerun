import 'server-only'
import { actorFromContext, type AccessLevel } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveAgentTarget, resolveRunTarget } from '@/app/api/_services/chat.service'
import { ApiError } from '@/lib/api-error'
import { getAgent as engineGetAgent, listConnections, patchAgent as enginePatchAgent } from '@/lib/engine/client'
import { connectionGroups } from '@/lib/engine/model-groups'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { FOREMAN_AGENT_ID, type AgentModels, type ModelChoice, type SetAgentModelInput } from '@rerun/contracts'

// The foreman has no agent row, so it resolves the way the web's picker resolves it, and stays every
// member's own to set. A coworker's model is part of what it is: setting it takes `manage`.
const targetOf = (ctx: WorkspaceContext, agentId: string, access: AccessLevel) => (agentId === FOREMAN_AGENT_ID ? resolveRunTarget(agentId) : resolveAgentTarget(agentId, actorFromContext(ctx), access))

const choiceOf = (connectionId: string | null | undefined, model: string | null | undefined): ModelChoice | null => (connectionId && model ? { connectionId, model } : null)

// The app's model picker for one coworker: the same groups as the web picker, with what the coworker
// pinned and what it runs today.
export async function readAgentModels(ctx: WorkspaceContext, agentId: string): Promise<AgentModels> {
    const { conn, engineAgentId } = await targetOf(ctx, agentId, 'use')
    const [detail, list, t] = await Promise.all([
        engineGetAgent(conn, engineAgentId),
        listConnections(conn),
        recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id).then(locale => translatorFor(locale, 'connections')),
    ])
    const groups = connectionGroups(list.connections, t)
    return {
        groups: groups.map(group => ({
            connectionId: group.connectionId,
            label: group.label,
            provider: group.provider,
            defaultModel: group.defaultModel,
            models: group.models.map(model => ({ id: model.id, label: model.label, description: model.description })),
        })),
        pinned: choiceOf(detail.config.connectionId, detail.config.model),
        resolved: choiceOf(detail.resolvedConnectionId, detail.resolvedModel),
        boxDefault: list.default ?? (groups[0] ? { connectionId: groups[0].connectionId, model: groups[0].defaultModel } : null),
    }
}

// Same patch as the web picker: a pin names its connection's provider, and following the box clears
// all three fields so no stale connection keeps showing in its usage.
export async function setAgentModel(ctx: WorkspaceContext, agentId: string, choice: SetAgentModelInput): Promise<void> {
    const { conn, engineAgentId } = await targetOf(ctx, agentId, 'manage')
    if (choice.model === null) {
        await enginePatchAgent(conn, engineAgentId, { connectionId: null, provider: null, model: null })
        return
    }
    const connection = (await listConnections(conn)).connections.find(entry => entry.id === choice.connectionId && entry.connected)
    if (!connection) throw new ApiError(400, 'This connection is not available on the machine')
    await enginePatchAgent(conn, engineAgentId, { connectionId: connection.id, provider: connection.provider, model: choice.model })
}
