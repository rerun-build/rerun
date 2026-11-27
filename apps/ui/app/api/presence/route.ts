import { clearPresence, touchPresence, touchSandboxActivity } from '@/app/api/_services/presence.service'
import { shouldStamp } from '@/lib/server/stamp-memory'
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

// The presence must stay fresh to the beat, the sandbox activity only to the hour: the database
// already refuses a second stamp within the hour, so most calls are spared too. The memory is per
// user while the database stamps the workspace that user is in now, so it stays short: a few minutes
// in a sandbox right after another workspace must still count as a visit.
const SANDBOX_ACTIVITY_INTERVAL_MS = 5 * 60_000

export async function POST(): Promise<Response> {
    const userId = await currentUserId()
    if (userId) await Promise.all([touchPresence(userId), shouldStamp(`presence-sandbox:${userId}`, SANDBOX_ACTIVITY_INTERVAL_MS) ? touchSandboxActivity(userId) : null])
    return new Response(null, { status: 204 })
}

export async function DELETE(): Promise<Response> {
    const userId = await currentUserId()
    if (userId) await clearPresence(userId)
    return new Response(null, { status: 204 })
}
