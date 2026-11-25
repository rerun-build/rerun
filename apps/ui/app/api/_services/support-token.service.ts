import 'server-only'

import { SUPPORT_CHAT_ENABLED } from '@rerun/cloud/support'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type SupportTokenInsert = Database['public']['Tables']['user_support_tokens']['Insert']

async function storedToken(admin: SupabaseClient<Database>, userId: string): Promise<string | null> {
    const { data, error } = await selectMaybeSingle(admin, 'user_support_tokens', ['token'] as const, { user_id: userId })
    if (error) throw error
    return data?.token ?? null
}

// The key Crisp finds this person's support conversation by, the same on every device they sign in
// from (without it, each browser keeps a conversation of its own). Made the first time it is asked
// for. Never logged nor sent anywhere but to Crisp: it opens the conversation. A self-hosted install
// has no support chat, so no key. A failure leaves the chat on the device's own conversation rather
// than taking the page down.
export async function supportChatTokenOf(admin: SupabaseClient<Database>, userId: string): Promise<string | null> {
    if (!SUPPORT_CHAT_ENABLED) return null
    try {
        const existing = await storedToken(admin, userId)
        if (existing) return existing
        const { error } = await admin.from('user_support_tokens').upsert<SupportTokenInsert>({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
        if (error) throw error
        return await storedToken(admin, userId)
    } catch (error) {
        console.error('[support-token] could not read the support chat key', error instanceof Error ? error.message : error)
        return null
    }
}
