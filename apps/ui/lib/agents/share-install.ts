import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { deriveUniqueHandle, importAgent } from '@/app/api/_services/agent.service'
import { downloadPrivateFile } from '@/lib/storage/private'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { isOpaqueToken } from '@/lib/opaque-token'
import type { GridPosition } from '@/lib/board/types'
import { AppError } from '@/lib/i18n/action-error'
import { staleImportError } from './capture-archive'
import { AGENT_SHARE_BUCKET, AGENT_SHARE_TOKEN_LENGTH } from './share-create'

// The mirror of `installTemplate`, for a link that carries exactly one agent. Nothing here opens
// the tarball: the engine is the only side that does, so the connectors the copy still needs are
// the ones its own registry already declares as needing auth.

export type AgentShareInstallOutcome = { agentId: string; agentName: string; inactive: boolean; warnings: string[] }

export async function installAgentShare(
    supabase: SupabaseClient<Database>,
    token: string,
    target: { workspaceId: number; spaceId: string; actor: Actor; position?: GridPosition },
): Promise<AgentShareInstallOutcome> {
    if (!isOpaqueToken(token, AGENT_SHARE_TOKEN_LENGTH)) throw new AppError('shareLinkGone')

    const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['id', 'archive_path', 'source_agent_name', 'install_count', 'revoked_at'] as const, { token })
    // Revoked, swept, or never real: one message for all three, so the link cannot be used to
    // confirm that something once existed here.
    if (!share || share.revoked_at || !share.archive_path) throw new AppError('shareLinkGone')

    const name = share.source_agent_name
    const handle = await deriveUniqueHandle(supabase, target.workspaceId, name)
    const blob = await downloadPrivateFile(supabase, AGENT_SHARE_BUCKET, share.archive_path)

    let imported
    try {
        imported = await importAgent({ archive: blob, name, handle, workspaceId: target.workspaceId, spaceId: target.spaceId, actor: target.actor, position: target.position })
    } catch (err) {
        if (err instanceof Error && /\/agents\/import failed: 404/.test(err.message)) throw staleImportError()
        throw err
    }

    // Informational only, and deliberately not a gate: the link has no install quota, so a lost
    // race here costs a wrong number on a panel, never a refused install.
    await supabase
        .from('agent_shares')
        .update<Database['public']['Tables']['agent_shares']['Update']>({ install_count: share.install_count + 1 })
        .eq('id', share.id)

    const warnings: string[] = []
    // The engine is the only side that opened the tarball, so a refused entry is the one thing the
    // recipient cannot see for themselves.
    if (imported.imported.skippedPaths.length > 0) {
        warnings.push(`${imported.imported.skippedPaths.length} file(s) in the archive were refused (${imported.imported.skippedPaths.slice(0, 3).join(', ')}).`)
    }
    // The copy answers to webhook addresses of its own, and nothing else will say so: the sender's
    // URLs stayed on their box.
    if (imported.imported.triggers.length > 0) {
        warnings.push(`${imported.imported.triggers.length} webhook(s) were created with a new URL each (${imported.imported.triggers.join(', ')}). Read them in the coworker panel and point your services at them.`)
    }
    if (imported.imported.envKeys.length > 0) {
        warnings.push(`${imported.imported.envKeys.length} API key(s) have to be filled in again before it can run.`)
    }

    return { agentId: imported.agent.id, agentName: name, inactive: Boolean(imported.agent.disabled_at), warnings }
}
