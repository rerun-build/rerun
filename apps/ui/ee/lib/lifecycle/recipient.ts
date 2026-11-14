import { realEmail } from '@/lib/auth/placeholder-email'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'

export type LifecycleRecipient = { email: string; firstName: string | null }

function readString(metadata: Record<string, unknown> | undefined, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' ? value.trim() : ''
}

function firstNameOf(metadata: Record<string, unknown> | undefined): string | null {
    const first = readString(metadata, 'first_name') || readString(metadata, 'given_name')
    if (first) return first
    const full = readString(metadata, 'full_name') || readString(metadata, 'name')
    return full.split(/\s+/)[0] || null
}

export async function loadRecipient(supabase: SupabaseClient<Database>, userId: string): Promise<LifecycleRecipient | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user || data.user.is_anonymous) return null

    const email = realEmail(data.user.email)?.trim()
    if (!email) return null

    return { email, firstName: firstNameOf(data.user.user_metadata) }
}

export async function loadFirstName(supabase: SupabaseClient<Database>, userId: string): Promise<string | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user) return null
    return firstNameOf(data.user.user_metadata)
}
