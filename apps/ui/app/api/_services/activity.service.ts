import 'server-only'

import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type UserUpdate = Database['public']['Tables']['users']['Update']

// An IANA zone the runtime knows, or nothing: the Chief of Staff's quiet hours are read in it.
export function validTimeZone(value: string | null | undefined): string | null {
    if (!value || value.length > 64) return null
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value })
        return value
    } catch {
        return null
    }
}

// A member opened the app: the Chief of Staff wakes rarely in a workspace nobody opened for a week,
// and never in the night of the member it speaks to.
export async function stampActivity(userId: string, timeZone: string | null | undefined): Promise<void> {
    const zone = validTimeZone(timeZone)
    const { error } = await createServiceRoleClient()
        .from('users')
        .update<UserUpdate>({ last_active_at: new Date().toISOString(), ...(zone ? { timezone: zone } : {}) })
        .eq('id', userId)
    if (error) console.error('[activity] stamp failed', error)
}
