import { clearPresence, touchPresence, touchSandboxActivity } from '@/app/api/_services/presence.service'
import { getSessionIdentity } from '@/supabase/session/getServerSession'

// A route handler rather than a server action: only fetch(keepalive) can still reach the server
// while the tab is closing, and that DELETE is what keeps a shut window from looking present for
// another minute and a half.
async function currentUserId(): Promise<string | null> {
    // The token alone, checked locally: this is called twice a minute per tab, and the page load
    // already asked the auth server whether the session still stands. An anonymous visitor has no
    // address to be spared.
    const identity = await getSessionIdentity()
    if (!identity || identity.is_anonymous === true) return null
    return identity.id
}

export async function POST(): Promise<Response> {
    const userId = await currentUserId()
    if (userId) await Promise.all([touchPresence(userId), touchSandboxActivity(userId)])
    return new Response(null, { status: 204 })
}

export async function DELETE(): Promise<Response> {
    const userId = await currentUserId()
    if (userId) await clearPresence(userId)
    return new Response(null, { status: 204 })
}
