import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { poolHasRoom } from '@rerun/cloud/engines'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export async function resolveEngineWaitlist(workspaceId: number): Promise<boolean> {
    if (await findWorkspaceEngine(workspaceId)) return false

    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['waitlisted_at', 'boxes_archived_at'] as const, { id: workspaceId })
    if (data?.boxes_archived_at) return false

    if (await poolHasRoom()) return false

    if (!data?.waitlisted_at) {
        const { error } = await supabase.from('workspaces').update<Database['public']['Tables']['workspaces']['Update']>({ waitlisted_at: new Date().toISOString() }).eq('id', workspaceId)
        if (error) console.error('[waitlist] failed to stamp workspace', workspaceId, error.message)
    }
    return true
}
