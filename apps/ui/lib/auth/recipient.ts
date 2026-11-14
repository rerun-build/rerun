import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { realEmail } from '@/lib/auth/placeholder-email'

export type Recipient = { email: string; firstName: string | null }

type Metadata = Record<string, unknown> | undefined

function text(metadata: Metadata, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' ? value.trim() : ''
}

function firstNameOf(metadata: Metadata): string | null {
    const first = text(metadata, 'first_name') || text(metadata, 'given_name')
    if (first) return first
    return (text(metadata, 'full_name') || text(metadata, 'name')).split(/\s+/)[0] || null
}

export async function loadRecipient(supabase: SupabaseClient<Database>, userId: string): Promise<Recipient | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user || data.user.is_anonymous) return null
    const email = realEmail(data.user.email)?.trim()
    return email ? { email, firstName: firstNameOf(data.user.user_metadata) } : null
}

export async function loadFirstName(supabase: SupabaseClient<Database>, userId: string): Promise<string | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user) return null
    return firstNameOf(data.user.user_metadata)
}
