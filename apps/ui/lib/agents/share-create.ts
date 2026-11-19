import type { SupabaseClient } from '@supabase/supabase-js'
import { shareContents, shareExcludePaths, type AgentArchivePlan, type AgentShareContents, type AgentShareInclude, type AgentSharePreview } from '@moldwright/contracts'
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

export const AGENT_SHARE_BUCKET = 'agent-shares'
export const AGENT_SHARE_TOKEN_LENGTH = 32

export async function shareUrl(token: string): Promise<string> {
    return `${await getAppOrigin()}/?share=${token}`
}

export type AgentSharePlan = {
    agentName: string
    contents: AgentShareContents
    warnings: string[]
    envKeyCount: number
    mcpAuthCount: number
}

const SPACE_DATA_WARNING = 'The Box database and the Box shared files stay here: a copy starts with an empty one.'

async function planFor(supabase: SupabaseClient<Database>, agentRowId: string, workspaceId: number) {
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
