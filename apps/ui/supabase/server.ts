import type { Database } from '@/app/api/database.types'
import { createServerClient } from '@supabase/ssr'
import { createClient as createTokenClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { readQueryWorkspace } from '@/lib/workspace/query-workspace'
import { WORKSPACE_HEADER } from '@/lib/workspace/workspace-header'

const BEARER_PREFIX = 'Bearer '

export async function getRequestAccessToken(): Promise<string | null> {
    try {
        const authorization = (await headers()).get('authorization') ?? ''
        const token = authorization.startsWith(BEARER_PREFIX) ? authorization.slice(BEARER_PREFIX.length).trim() : ''
        return token || null
    } catch {
        return null
    }
}

export async function getRequestWorkspaceId(): Promise<number | null> {
    try {
        const raw = (await headers()).get(WORKSPACE_HEADER) ?? readQueryWorkspace()
        if (raw === null) return null
        return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN
    } catch {
        return null
    }
}

export function createSessionlessClient() {
    return createTokenClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
}

export async function createClient() {
    const accessToken = await getRequestAccessToken()
    if (accessToken) {
        return createTokenClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
            global: { headers: { Authorization: `${BEARER_PREFIX}${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
    }

    const cookieStore = await cookies()

    return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        cookies: {
            getAll() {
                return cookieStore.getAll()
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
                } catch {
                }
            },
        },
    })
}
