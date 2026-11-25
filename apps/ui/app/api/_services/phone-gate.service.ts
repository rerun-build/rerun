import 'server-only'
import type { Database } from '@/app/api/database.types'
import { isRerunHost } from '@/lib/brand/request-site'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

// The phone wall of the browser (SessionProvider), held on the server too: an account owes a number
// only while its user_phones row is neither verified nor skipped. No row, or a read that failed,
// owes nothing, so nobody is locked behind a wall that cannot tell whether it applies. Nor does anyone
// on an organization's address, which never asks.
export async function isPhoneStepPending(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
    if (!(await isRerunHost())) return false
    const { data, error } = await selectMaybeSingle(supabase, 'user_phones', ['verified_at', 'skipped_at'] as const, { user_id: userId })
    if (error) return false
    return !!data && !data.verified_at && !data.skipped_at
}
