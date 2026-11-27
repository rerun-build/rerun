import type { Database } from '@/app/api/database.types'
import type { PresenceRow } from '@/lib/notifications/presence'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

type PresenceInsert = Database['public']['Tables']['user_presence']['Insert']

// `last_seen_at` is stamped here rather than sent by the tab: a browser clock that runs fast would
// otherwise let someone silence their own emails.
export async function touchPresence(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient()
        .from('user_presence')
        .upsert<PresenceInsert>({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) console.error('[presence] heartbeat failed', error)
}

// A visible tab is the sign of life the sandbox idle sweep reads. The function throttles itself to
// one write an hour, and a failure costs nothing: the presence route calls again a few minutes later.
export async function touchSandboxActivity(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient().rpc('touch_sandbox_activity', { p_user_id: userId })
    if (error) console.error('[presence] sandbox activity stamp failed', error)
}

export async function clearPresence(userId: string): Promise<void> {
    const { error } = await createServiceRoleClient().from('user_presence').delete().eq('user_id', userId)
    if (error) console.error('[presence] clear failed', error)
}

// A failed read answers "nobody is here", so the emails go out. That is the only direction it is
// acceptable to be wrong in: the alternative silences a notification over a network blip.
export async function loadPresence(supabase: SupabaseClient<Database>, userIds: string[]): Promise<PresenceRow[]> {
    if (!userIds.length) return []
    const { data, error } = await selectMany(supabase, 'user_presence', ['user_id', 'last_seen_at'] as const, { user_id: userIds })
    if (error) {
        console.error('[presence] lookup failed', error)
        return []
    }
    return data ?? []
}
