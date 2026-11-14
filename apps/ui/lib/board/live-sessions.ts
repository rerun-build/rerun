import type { Database } from '@/app/api/database.types'
import type { SessionEntry, SessionStatus } from '@/lib/board/types'
import { selectMany } from '@/supabase/supabase-helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

type Client = SupabaseClient<Database>

const STALE_THRESHOLD_MS = 5 * 60 * 1000
const STALE_CHECK_LIMIT = 10

export async function fetchLiveSessions(supabase: Client, agentIds: string[]): Promise<SessionEntry[] | null> {
    const { data } = await selectMany(supabase, 'sessions', ['id', 'agent_id', 'origin_agent_id', 'status'] as const, { agent_id: agentIds, status: { neq: 'idle' } }, { column: 'updated_at', ascending: false }, 500)
    return data?.map(s => ({ id: s.id, agentId: s.agent_id, originAgentId: s.origin_agent_id, status: (s.status as SessionStatus) || 'idle' })) ?? null
}

export async function sweepZombieSessions(supabase: Client, sessions: SessionEntry[], idleAmong: (sessionIds: string[]) => Promise<string[]>): Promise<string[]> {
    const staleSessionIds = sessions.filter(s => s.status === 'working').map(s => s.id)
    if (staleSessionIds.length === 0) return []

    const now = Date.now()
    const { data: fullSessions } = await selectMany(supabase, 'sessions', ['id', 'updated_at'] as const, { id: staleSessionIds })

    const candidates = (fullSessions ?? [])
        .filter(s => s.updated_at && now - new Date(s.updated_at).getTime() > STALE_THRESHOLD_MS)
        .slice(0, STALE_CHECK_LIMIT)
        .map(s => s.id)
    if (candidates.length === 0) return []

    const zombieIds = await idleAmong(candidates).catch((): string[] => [])
    if (zombieIds.length === 0) return []

    await supabase.from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ status: 'idle' }).in('id', zombieIds)
    for (const s of sessions) {
        if (zombieIds.includes(s.id)) s.status = 'idle'
    }
    return zombieIds
}
