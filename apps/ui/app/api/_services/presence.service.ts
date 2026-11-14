import type { Database } from '@/app/api/database.types'
import type { PresenceRow } from '@/lib/notifications/presence'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

type PresenceInsert = Database['public']['Tables']['user_presence']['Insert']

export async function touchPresence(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient()
        .from('user_presence')
        .upsert<PresenceInsert>({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) console.error('[presence] heartbeat failed', error)
}

export async function touchSandboxActivity(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient().rpc('touch_sandbox_activity', { p_user_id: userId })
    if (error) console.error('[presence] sandbox activity stamp failed', error)
}

export async function clearPresence(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient().from('user_presence').delete().eq('user_id', userId)
    if (error) console.error('[presence] clear failed', error)
}

export async function loadPresence(supabase: SupabaseClient<Database>, userIds: string[]): Promise<PresenceRow[]> {
    if (!userIds.length) return []
    const { data, error } = await selectMany(supabase, 'user_presence', ['user_id', 'last_seen_at'] as const, { user_id: userIds })
    if (error) {
        console.error('[presence] lookup failed', error)
        return []
    }
    return data ?? []
}
