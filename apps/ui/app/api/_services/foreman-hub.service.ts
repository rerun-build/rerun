import 'server-only'

import { isAdminActor, type Actor } from '@/app/api/_auth/access'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { dispatchBoxTool } from '@/lib/foreman/box-tools'
import { FOREMAN_ENGINE_HUB_TOOL_NAMES, FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES } from '@/lib/foreman/engine-brief'
import { dispatchWorkspaceOnboardingTool } from '@/lib/foreman/onboarding-tools'
import { FOREMAN_NAME_MAX, sanitizeForemanName } from '@/lib/foreman/name'
import { saveForemanName } from '@/lib/foreman/profile'
import { searchDocs } from '@/lib/foreman/search-docs'
import { FOREMAN_BOX_TOOL_DEFS } from '@/lib/foreman/tool-defs'
import { requireString } from '@/lib/mcp/args'
import { createServiceRoleClient } from '@/supabase/serviceRole'

const BOX_TOOL_NAMES = new Set<string>(FOREMAN_BOX_TOOL_DEFS.map(def => def.name))

// What the engine foreman may do to its workspace, and nothing more: the same allowlist the hub
// hands it as its belt, so a tool name it was never given is refused here too.
export async function dispatchForemanHubTool(actor: Actor, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const workspaceId = actor.workspaceId
    if (!FOREMAN_ENGINE_HUB_TOOL_NAMES.has(tool)) throw new Error(`Unknown foreman tool: ${tool}`)

    if (tool === 'search_docs') return searchDocs(requireString(args.query, 'query'))
    if (tool === 'set_name') return setName(actor, args)

    // The turn speaks for the member who wrote it: a Box they create is theirs to manage, a coworker
    // lands only in a Box they manage, and only their Boxes are listed. A turn with nobody behind it
    // speaks for the workspace, as the account owner.
    const userId = actor.kind === 'user' ? actor.userId : await founderOf(workspaceId)
    if (BOX_TOOL_NAMES.has(tool)) return dispatchBoxTool({ workspaceId, userId, actor }, tool, args)
    if (FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES.has(tool)) return dispatchWorkspaceOnboardingTool({ supabase: createServiceRoleClient(), userId, workspace: { id: workspaceId }, actor }, tool, args)

    return dispatchAccountTool(actor, tool, args, { actorUserId: actor.kind === 'user' ? actor.userId : null })
}

async function founderOf(workspaceId: number): Promise<string> {
    const userId = await workspaceFounderUserId(workspaceId)
    if (!userId) throw new Error('This workspace has no member to act for.')
    return userId
}

async function setName(actor: Actor, args: Record<string, unknown>): Promise<{ name: string }> {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can rename you. Tell the user to ask one.')
    const name = sanitizeForemanName(args.name)
    if (!name) throw new Error(`That name cannot be used: 1 to ${FOREMAN_NAME_MAX} letters, digits, spaces, dots, apostrophes or hyphens.`)
    await saveForemanName({ supabase: createServiceRoleClient(), workspace: { id: actor.workspaceId } }, name)
    return { name }
}
