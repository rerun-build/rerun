import type { SupabaseClient } from '@supabase/supabase-js'
import { AccessDeniedError, assertAgentInWorkspace, isAdminActor, manageableSpaceIds, type Actor } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'

// A link exports the coworker's whole setup, so it belongs to whoever manages its Box: a member sees
// and revokes only those. A link whose coworker was deleted since is left to the admins. The dialog
// and the foreman's share tools hold to the same rule.
export async function shareManageableAgentIds(actor: Actor): Promise<'all' | Set<string>> {
    const spaces = await manageableSpaceIds(actor)
    if (spaces === 'all' || spaces.size === 0) return spaces
    const { data: agents } = await selectAll(createServiceRoleClient(), 'agents', ['id'] as const, { workspace_id: actor.workspaceId, space_id: [...spaces] })
    return new Set((agents ?? []).map(agent => agent.id))
}

export async function assertCanManageShare(supabase: SupabaseClient<Database>, shareId: string, actor: Actor): Promise<void> {
    if (isAdminActor(actor)) return
    const { data: share } = await selectMaybeSingle(supabase, 'agent_shares', ['source_agent_id'] as const, { id: shareId, workspace_id: actor.workspaceId })
    if (!share) throw new AppError('shareLinkNotFound')
    if (!share.source_agent_id) throw new AccessDeniedError()
    await assertAgentInWorkspace(share.source_agent_id, 'manage', actor)
}
