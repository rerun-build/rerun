import 'server-only'
import type { Database } from '@/app/api/database.types'
import { placeholderEmailFor } from '@/lib/auth/placeholder-email'
import { selectMany } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

export const UNIQUE_VIOLATION = '23505'

export type PhoneAccount = { id: string; email: string | null }

export type PhoneStanding = 'free' | 'taken' | 'same_number' | 'unavailable'

export async function phoneOwnerId(admin: SupabaseClient<Database>, phone: string): Promise<{ userId: string | null } | null> {
    const { data: owners, error } = await selectMany(admin, 'user_phones', ['user_id'] as const, { phone, verified_at: { notNull: true } }, { column: 'required_at', ascending: true }, 1)
    if (error) return null
    return { userId: owners?.[0]?.user_id ?? null }
}

export async function phoneStandingFor(admin: SupabaseClient<Database>, account: PhoneAccount, phone: string): Promise<PhoneStanding> {
    const owner = await phoneOwnerId(admin, phone)
    if (!owner) return 'unavailable'
    if (owner.userId) return owner.userId === account.id ? 'same_number' : 'taken'

    const placeholder = placeholderEmailFor(phone)
    if (account.email?.toLowerCase() === placeholder) return 'free'
    const { data: held, error } = await admin.rpc('check_email_exists', { email: placeholder })
    if (error) return 'unavailable'
    return held ? 'taken' : 'free'
}
