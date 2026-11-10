import type { SupabaseClient } from '@supabase/supabase-js'
import { shareContents, shareExcludePaths, type AgentArchivePlan, type AgentShareContents, type AgentShareInclude, type AgentSharePreview } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { getSpaceConnection } from '@/app/api/_services/space.service'
import { planAgentArchive } from '@/lib/engine/client'
import { connectorSkillSlugs, readRegistry } from '@/lib/services/registry'
import { getAppOrigin } from '@/lib/app-origin'
import { opaqueToken } from '@/lib/opaque-token'
import { selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import { uploadPrivateFile } from '@/lib/storage/private'
import { projectAgent } from '@/lib/templates/archives'
import { resolveAgentConnectors } from '@/lib/templates/connectors'
import { AppError } from '@/lib/i18n/action-error'
import { archiveWarnings, captureAgentArchive, isMissingRoute, staleExportError } from './capture-archive'

// Sending an agent is not publishing one. A template is a page anyone installs in a loop, which is
// why capturing for the marketplace is locked to the sandbox; a share is a transfer to one person
// behind an unguessable token, revocable at any time, and the snapshot it hands over is frozen at
// creation. That is what makes it safe to open to every workspace, and it is the reason this file
// does not go through `requireSandboxAuthorSession`.

export const AGENT_SHARE_BUCKET = 'agent-shares'
export const AGENT_SHARE_TOKEN_LENGTH = 32

// The origin the app is actually served on, not the hub base URL: that one is where the engine
// reaches the UI from its own host, and in dev each Conductor workspace answers on its own port.
export async function shareUrl(token: string): Promise<string> {
    return `${await getAppOrigin()}/?share=${token}`
}

// What the form needs to let someone decide: the three buckets priced, and everything about the
// copy that nobody can see once the tarball is closed.
export type AgentSharePlan = {
    agentName: string
    contents: AgentShareContents
    warnings: string[]
    envKeyCount: number
    mcpAuthCount: number
}

// Neither the Space database (`shared-db/shared.db`) nor the Space files (`shared/`) are in the
// engine's archive roots, so an agent that works out of them arrives amnesiac. Nothing in the plan
// says so, which is exactly why it has to be said here.
const SPACE_DATA_WARNING = 'The Box database and the Box shared files stay here: a copy starts with an empty one.'

async function planFor(supabase: SupabaseClient<Database>, agentRowId: string, workspaceId: number) {
    // The engine id addresses a folder on a box, so it is resolved from the row rather than taken
    // from the caller: a forged one would archive an agent nothing here owns.
    const { data: agent } = await selectSingle(supabase, 'agents', ['name', 'space_id', 'engine_agent_id', 'workspace_id'] as const, { id: agentRowId })
    if (!agent || agent.workspace_id !== workspaceId || !agent.engine_agent_id) throw new AppError('coworkerNotFound')

    const conn = await getSpaceConnection(agent.space_id)
    try {
        return { agent, conn, plan: await planAgentArchive(conn, agent.engine_agent_id) }
    } catch (err) {
        throw isMissingRoute(err) ? staleExportError() : err
    }
}

export async function planAgentShare(supabase: SupabaseClient<Database>, agentRowId: string, workspaceId: number): Promise<AgentSharePlan> {
    const { agent, plan } = await planFor(supabase, agentRowId, workspaceId)
    return {
        agentName: plan.displayName || agent.name,
        contents: shareContents(plan),
        warnings: [...archiveWarnings(plan, plan.displayName || agent.name), SPACE_DATA_WARNING],
        envKeyCount: plan.envKeys.length,
        mcpAuthCount: plan.mcpAuth.length,
    }
}

async function buildPreview(
    supabase: SupabaseClient<Database>,
    plan: AgentArchivePlan,
    connectorSkills: Set<string>,
    include: AgentShareInclude,
    sharedBy: string | null,
): Promise<AgentSharePreview> {
    // `projectAgent` is the same editorial filter a template card goes through: connector skills
    // dropped, one-shot schedules dropped, disabled webhooks dropped. The key it needs is inert
    // here, a share holds exactly one agent.
    const agent = projectAgent(plan, 'agent', connectorSkills)
    const { connectors } = await resolveAgentConnectors(supabase, [agent])
    return {
        agent,
        connectors,
        envKeyCount: plan.envKeys.length,
        mcpAuthCount: plan.mcpAuth.length,
        include,
        contents: shareContents(plan),
        capturedAt: new Date().toISOString(),
        sharedBy,
    }
}

export type CreatedShare = { token: string; url: string; warnings: string[]; reused: boolean }

export async function createAgentShare(
    supabase: SupabaseClient<Database>,
    input: { agentRowId: string; workspaceId: number; userId: string; include: AgentShareInclude },
): Promise<CreatedShare> {
    const { agentRowId, workspaceId, userId, include } = input

    // A capture streams up to 150 MB off the source box, so clicking Share twice on the same agent
    // with the same answers hands back the link that already exists instead of taking a second
    // snapshot. Same reflex as `inviteToWorkspaceAction` with a pending invitation.
    const { data: existing } = await selectMaybeSingle(
        supabase,
        'agent_shares',
        ['token'] as const,
        {
            source_agent_id: agentRowId,
            workspace_id: workspaceId,
            revoked_at: { isNull: true },
            include_memories: include.memories,
            include_database: include.database,
            include_files: include.files,
        },
        { column: 'created_at', ascending: false },
    )
    if (existing) return { token: existing.token, url: await shareUrl(existing.token), warnings: [], reused: true }

    const { agent, conn, plan: fullPlan } = await planFor(supabase, agentRowId, workspaceId)
    const exclude = shareExcludePaths(fullPlan, include)
    const { plan, bytes } = await captureAgentArchive(conn, agent.engine_agent_id as string, exclude)

    const connectorSkills = connectorSkillSlugs(await readRegistry(conn, agent.engine_agent_id as string))
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['name'] as const, { id: workspaceId })
    const preview = await buildPreview(supabase, plan, connectorSkills, include, workspace?.name?.trim() || null)

    const token = opaqueToken(AGENT_SHARE_TOKEN_LENGTH)
    // The token names the object, so a row that fails to insert leaves something the sweeper can
    // still name, and two links never share a path.
    const archivePath = `${workspaceId}/${token}.tar.gz`
    await uploadPrivateFile(supabase, AGENT_SHARE_BUCKET, archivePath, bytes, 'application/gzip')

    const { error } = await supabase.from('agent_shares').insert<Database['public']['Tables']['agent_shares']['Insert']>({
        token,
        workspace_id: workspaceId,
        created_by: userId,
        source_agent_id: agentRowId,
        source_agent_name: preview.agent.name,
        preview,
        archive_path: archivePath,
        archive_bytes: bytes.byteLength,
        engine_commit: plan.engineCommit,
        include_memories: include.memories,
        include_database: include.database,
        include_files: include.files,
    })
    if (error) throw new Error(error.message)

    return { token, url: await shareUrl(token), warnings: [...archiveWarnings(plan, preview.agent.name), SPACE_DATA_WARNING], reused: false }
}
