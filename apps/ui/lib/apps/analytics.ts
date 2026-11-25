// No 'server-only': the trial sweep reports from Trigger.dev.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsEventMap, EventName } from '@rerun/analytics'
import { captureServer } from '@rerun/analytics/server'
import { selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'

// The first member's login email is the distinct_id the rest of the workspace's events use. Best
// effort, like every reporter: analytics never fails the change it reports.
export async function reportWorkspaceEvent<E extends EventName>(supabase: SupabaseClient<Database>, workspaceId: number, event: E, properties: AnalyticsEventMap[E]): Promise<void> {
    try {
        const { data: members } = await selectWorkspaceMembers(supabase, ['user_id'] as const, { workspace_id: workspaceId })
        const owner = members?.[0]
        if (!owner) return
        const { data } = await supabase.auth.admin.getUserById(owner.user_id)
        if (data.user?.email) await captureServer(data.user.email, event, properties)
    } catch (err) {
        console.warn(`[apps] could not report ${event}`, err)
    }
}
