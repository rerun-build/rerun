import type { SupabaseClient } from '@supabase/supabase-js'
import { agentSharePreviewSchema, type AgentSharePreview } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { isOpaqueToken } from '@/lib/opaque-token'
import { removePrivateFiles } from '@/lib/storage/private'
import { selectAll, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AGENT_SHARE_BUCKET, AGENT_SHARE_TOKEN_LENGTH, shareUrl } from './share-create'

export async function readAgentShare(supabase: SupabaseClient<Database>, token: string): Promise<AgentSharePreview | null> {
    if (!isOpaqueToken(token, AGENT_SHARE_TOKEN_LENGTH)) return null

    const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['preview', 'revoked_at'] as const, { token })
    if (!share || share.revoked_at) return null

    const parsed = agentSharePreviewSchema.safeParse(share.preview)
    return parsed.success ? parsed.data : null
}

export type WorkspaceShare = {
    id: string
    url: string
    sourceAgentId: string | null
    agentName: string
    createdAt: string
    installCount: number
    include: { memories: boolean; database: boolean; files: boolean }
}

export async function listWorkspaceShares(supabase: SupabaseClient<Database>, workspaceId: number): Promise<WorkspaceShare[]> {
    const columns = ['id', 'token', 'source_agent_id', 'source_agent_name', 'created_at', 'install_count', 'include_memories', 'include_database', 'include_files'] as const
    const { data } = await selectAll(supabase, 'agent_shares', columns, { workspace_id: workspaceId, revoked_at: { isNull: true } }, { column: 'created_at', ascending: false })

    return await Promise.all(
        (data ?? []).map(async row => ({
            id: row.id,
            url: await shareUrl(row.token),
            sourceAgentId: row.source_agent_id,
            agentName: row.source_agent_name,
            createdAt: row.created_at,
            installCount: row.install_count,
            include: { memories: row.include_memories, database: row.include_database, files: row.include_files },
        })),
    )
}

export async function revokeAgentShare(supabase: SupabaseClient<Database>, shareId: string, workspaceId: number): Promise<void> {
    const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['archive_path', 'workspace_id'] as const, { id: shareId })
    if (!share || share.workspace_id !== workspaceId) throw new Error('Share link not found')

    const { error } = await supabase
        .from('agent_shares')
        .update<Database['public']['Tables']['agent_shares']['Update']>({ revoked_at: new Date().toISOString(), archive_path: '' })
        .eq('id', shareId)
        .eq('workspace_id', workspaceId)
    if (error) throw new Error(error.message)

    if (share.archive_path) await removePrivateFiles(supabase, AGENT_SHARE_BUCKET, [share.archive_path]).catch(() => {})
}
