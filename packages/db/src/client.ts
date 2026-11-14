import { createClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

const SERVER_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

export function createPublicClient() {
    return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: SERVER_AUTH,
    })
}

export function createServiceRoleClient() {
    return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: SERVER_AUTH,
    })
}
