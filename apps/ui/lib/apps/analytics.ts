import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsEventMap, EventName } from '@rerun/analytics'
import { captureServer } from '@rerun/analytics/server'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'

export async function reportWorkspaceEvent<E extends EventName>(supabase: SupabaseClient<Database>, workspaceId: number, event: E, properties: AnalyticsEventMap[E]): Promise<void> {
    try {
        const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at' }, 1)
        const owner = members?.[0]
        if (!owner) return
        const { data } = await supabase.auth.admin.getUserById(owner.user_id)
        if (data.user?.email) await captureServer(data.user.email, event, properties)
    } catch (err) {
        console.warn(`[apps] could not report ${event}`, err)
    }
}
