import { isUuid, resolveShareInclude, type AgentShareInclude } from '@rerun/contracts'
import { assertAgentInWorkspace, keepVisible, type Actor } from '@/app/api/_auth/access'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { assertCanManageShare, shareManageableAgentIds } from '@/lib/agents/share-access'
import { createAgentShare, planAgentShare } from '@/lib/agents/share-create'
import { listWorkspaceShares, revokeAgentShare } from '@/lib/agents/share-read'
import { requireAgreement, requireConfirmation, requireString } from '@/lib/mcp/args'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { dispatchTemplateTool } from './mcp-templates.service'

// The sharing half of the account MCP server (app/api/mcp/account/route.ts). It sits between the
// agent half and the template half for a reason: `runTemplateTool` resolves an expert sandbox
// author before its own switch, so anything routed through it pays that gate. Sharing has no gate
// of its own — a link is a transfer to one person behind an unguessable, revocable token, not a
// page anyone installs from — so it has to be reached first, and it resolves nothing before its
// switch either.
//
// Every handler runs as the caller: the workspace for an API key, the member a foreman turn speaks
// for. A link exports a coworker's whole setup, so each one takes `manage` on its Box, the rule the
// share dialog holds to. The functions in lib/agents re-check the workspace against the row they load.

function requireId(args: Record<string, unknown>, field: string): string {
    const value = requireString(args[field], field)
    if (!isUuid(value)) throw new Error(`${field} must be the uuid of a ${field === 'shareId' ? 'share link, from list_agent_shares' : 'Rerun coworker, from list_agents'}.`)
    return value
}

// What the confirmation is about, written for the person the model is going to ask.
function describeInclude(include: AgentShareInclude): string {
    const carried = [include.memories && 'the memories of this coworker', include.database && 'its private database', include.files && 'its workspace files'].filter(Boolean) as string[]
    return carried.length === 1 ? carried[0] : `${carried.slice(0, -1).join(', ')} and ${carried[carried.length - 1]}`
}

export async function dispatchShareTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabase = createServiceRoleClient()
    const workspaceId = actor.workspaceId

    switch (name) {
        case 'plan_agent_share': {
            const agentId = requireId(args, 'agentId')
            await assertAgentInWorkspace(agentId, 'manage', actor)
            const plan = await planAgentShare(supabase, agentId, workspaceId)
            return {
                agentId,
                agentName: plan.agentName,
                contents: plan.contents,
                envKeyCount: plan.envKeyCount,
                mcpAuthCount: plan.mcpAuthCount,
                warnings: plan.warnings,
                includeDefaults: resolveShareInclude(undefined),
            }
        }

        case 'create_agent_share': {
            const agentId = requireId(args, 'agentId')
            const include = resolveShareInclude(args.include)
            await assertAgentInWorkspace(agentId, 'manage', actor)

            // Gated on the intention, not on the contents: unlike the dialog, which has already
            // priced the buckets on screen, knowing here whether a switch is empty would cost a
            // second round trip to the Box — and a model that turned `database` on has made a
            // decision either way.
            if (include.memories || include.database || include.files) requireAgreement(args, describeInclude(include))

            const userId = actor.kind === 'user' ? actor.userId : await workspaceFounderUserId(workspaceId)
            if (!userId) throw new Error('This workspace has no member, so no author can be resolved from this key.')

            const { token, url, warnings, reused } = await createAgentShare(supabase, { agentRowId: agentId, workspaceId, userId, include })
            // The token is the capability. It travels inside the URL because that is the product,
            // never as a field of its own that invites recomposing a link instead of copying it.
            const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['id'] as const, { token })

            return { shareId: share?.id ?? null, url, include, reused, warnings, expires: 'never' }
        }

        case 'list_agent_shares': {
            const [all, manageable] = await Promise.all([listWorkspaceShares(supabase, workspaceId), shareManageableAgentIds(actor)])
            const shares = keepVisible(all, manageable, share => share.sourceAgentId)
            return {
                shares: shares.map(share => ({
                    shareId: share.id,
                    url: share.url,
                    agentId: share.sourceAgentId,
                    agentName: share.agentName,
                    createdAt: share.createdAt,
                    installCount: share.installCount,
                    include: share.include,
                })),
                activeCount: shares.length,
            }
        }

        case 'revoke_agent_share': {
            requireConfirmation(args, 'the shared copy of this coworker and the archive behind it')
            const shareId = requireId(args, 'shareId')
            await assertCanManageShare(supabase, shareId, actor)
            await revokeAgentShare(supabase, shareId, workspaceId)
            return { shareId, revoked: true }
        }

        default:
            return await dispatchTemplateTool(workspaceId, name, args)
    }
}
