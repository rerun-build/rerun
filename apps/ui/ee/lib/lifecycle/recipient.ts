import { loadEmailRecipient } from '@/lib/email/recipient'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'

export type LifecycleRecipient = { email: string; firstName: string | null }

function readString(metadata: Record<string, unknown> | undefined, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' ? value.trim() : ''
}

// The same fallback as lib/onboarding/user-name.ts, redeclared rather than imported: that module is
// 'use client' and pulls the browser Supabase client into whatever imports it.
function firstNameOf(metadata: Record<string, unknown> | undefined): string | null {
    const first = readString(metadata, 'first_name') || readString(metadata, 'given_name')
    if (first) return first
    const full = readString(metadata, 'full_name') || readString(metadata, 'name')
    return full.split(/\s+/)[0] || null
}

// Null when there is nobody to write to: see `loadEmailRecipient`.
export async function loadRecipient(supabase: SupabaseClient<Database>, userId: string): Promise<LifecycleRecipient | null> {
    const recipient = await loadEmailRecipient(supabase, userId)
    return recipient && { email: recipient.email, firstName: firstNameOf(recipient.user.user_metadata) }
}

// A WhatsApp message needs a first name and no address: someone who signed in by phone has none.
export async function loadFirstName(supabase: SupabaseClient<Database>, userId: string): Promise<string | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user) return null
    return firstNameOf(data.user.user_metadata)
}
