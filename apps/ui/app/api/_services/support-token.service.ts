import 'server-only'

import { SUPPORT_CHAT_ENABLED } from '@rerun/cloud/support'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// The key Crisp finds this person's support conversation by, the same on every device they sign in
// from (without it, each browser keeps a conversation of its own). Never logged nor sent anywhere but
// to Crisp: it opens the conversation. Column privileges hide it from the browser's own client, so
// `admin` is the service role. A self-hosted install has no support chat, so no key. A failure leaves
// the chat on the device's own conversation rather than taking the page down.
export async function supportChatTokenOf(admin: SupabaseClient<Database>, userId: string): Promise<string | null> {
    if (!SUPPORT_CHAT_ENABLED) return null
    const { data, error } = await selectMaybeSingle(admin, 'users', ['support_token'] as const, { id: userId })
    if (error) console.error('[support-token] could not read the support chat key', error.message)
    return data?.support_token ?? null
}
