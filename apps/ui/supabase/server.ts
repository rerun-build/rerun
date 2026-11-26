import type { Database } from '@/app/api/database.types'
import { createServerClient } from '@supabase/ssr'
import { createClient as createTokenClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { callerUserAgent } from '@/lib/auth/two-step/devices'
import { readQueryWorkspace } from '@/lib/workspace/query-workspace'
import { PAGE_HEADER, WORKSPACE_HEADER } from '@/lib/workspace/workspace-header'

const BEARER_PREFIX = 'Bearer '

// The mobile app authenticates with the user's Supabase access token instead of cookies. Outside a
// request scope (build time, scripts) `headers()` throws, which reads as "no token".
export async function getRequestAccessToken(): Promise<string | null> {
    try {
        const authorization = (await headers()).get('authorization') ?? ''
        const token = authorization.startsWith(BEARER_PREFIX) ? authorization.slice(BEARER_PREFIX.length).trim() : ''
        return token || null
    } catch {
        return null
    }
}

// Each device, and each browser tab, keeps its own active workspace and names it on every request
// instead of moving `users.workspace_id` under the others. A request naming none (a page load, an
// OAuth callback) follows the stored column. NaN stands for a header that is present but not an id.
export async function getRequestWorkspaceId(): Promise<number | null> {
    try {
        const raw = (await headers()).get(WORKSPACE_HEADER) ?? readQueryWorkspace()
        if (raw === null) return null
        return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN
    } catch {
        return null
    }
}

// Whether a page is being rendered, as opposed to a call it makes or a provider coming back.
export async function isPageRequest(): Promise<boolean> {
    try {
        return (await headers()).get(PAGE_HEADER) !== null
    } catch {
        return false
    }
}

// For a route that signs someone in from the app: there is no cookie to read or write, and the session
// it opens goes back in the response instead of being kept.
export function createSessionlessClient() {
    return createTokenClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
}

// The caller's own browser or app, so a session the hub opens for them (the OAuth callback, the desktop
// hand-off) is listed under it in "Where you're signed in" rather than as the server.
async function requestUserAgent(): Promise<Record<string, string>> {
    try {
        return callerUserAgent(await headers())
    } catch {
        return {}
    }
}

export async function createClient() {
    const [accessToken, userAgent] = await Promise.all([getRequestAccessToken(), requestUserAgent()])
    if (accessToken) {
        return createTokenClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
            global: { headers: { ...userAgent, Authorization: `${BEARER_PREFIX}${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
    }

    const cookieStore = await cookies()

    return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        global: { headers: userAgent },
        cookies: {
            getAll() {
                return cookieStore.getAll()
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
                } catch {
                    // The `setAll` method was called from a Server Component.
                    // This can be ignored if you have middleware refreshing
                    // user sessions.
                }
            },
        },
    })
}
