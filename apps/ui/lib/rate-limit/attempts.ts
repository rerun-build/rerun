import 'server-only'
import { createServiceRoleClient } from '@/supabase/serviceRole'

// One try against every scope at once, counted in `published_gate_attempts`: false once any of them
// has had `max` tries in its window.
export async function claimAttempt(scopes: string[], max: number, windowSeconds: number): Promise<boolean> {
    const { data, error } = await createServiceRoleClient().rpc('claim_published_gate_attempt', { p_scopes: scopes, p_max: max, p_window_seconds: windowSeconds })
    if (error) throw new Error(`Attempt limit check failed: ${error.message}`)
    return data === true
}
