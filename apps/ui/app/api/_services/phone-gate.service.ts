import 'server-only'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isPhoneStepPending(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
    const { data, error } = await selectMaybeSingle(supabase, 'user_phones', ['verified_at', 'skipped_at'] as const, { user_id: userId })
    if (error) return false
    return !!data && !data.verified_at && !data.skipped_at
}
