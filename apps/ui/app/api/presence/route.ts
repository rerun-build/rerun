import { clearPresence, touchPresence, touchSandboxActivity } from '@/app/api/_services/presence.service'
import { createClient } from '@/supabase/server'

async function currentUserId(): Promise<string | null> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user || data.user.is_anonymous) return null
    return data.user.id
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
