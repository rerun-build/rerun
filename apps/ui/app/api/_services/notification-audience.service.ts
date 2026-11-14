import 'server-only'

import type { Database } from '@/app/api/database.types'
import type { EngineCreatedEvent } from '@/lib/engine/types'
import { coworkerRuleOf, normalizeNotificationPrefs, type NotificationPrefs } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type ParticipantInsert = Database['public']['Tables']['session_participants']['Insert']
type UserUpdate = Database['public']['Tables']['users']['Update']
type SessionReadInsert = Database['public']['Tables']['session_reads']['Insert']

export async function recordSessionParticipant(sessionId: string | null | undefined, userId: string | null | undefined): Promise<void> {
    if (!sessionId || !userId) return
    try {
        const { error } = await createServiceRoleClient()
            .from('session_participants')
            .upsert<ParticipantInsert>({ session_id: sessionId, user_id: userId, last_message_at: new Date().toISOString() }, { onConflict: 'session_id,user_id' })
        if (error) console.error('[notifications] failed to record the participant', error)
    } catch (err) {
        console.error('[notifications] failed to record the participant', err)
    }
}

export async function recordSessionRead(sessionId: string | null | undefined, userId: string | null | undefined): Promise<void> {
    if (!sessionId || !userId) return
    try {
        const { error } = await createServiceRoleClient()
            .from('session_reads')
            .upsert<SessionReadInsert>({ session_id: sessionId, user_id: userId, seen_at: new Date().toISOString() }, { onConflict: 'session_id,user_id' })
        if (error) console.error('[notifications] failed to record the read', error)
    } catch (err) {
        console.error('[notifications] failed to record the read', err)
    }
}

export async function writeNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
    const { error } = await createServiceRoleClient()
        .from('users')
        .update<UserUpdate>({ email_notification_prefs: prefs as unknown as UserUpdate['email_notification_prefs'] })
        .eq('id', userId)
    if (error) throw new Error(error.message)
}

export async function followCoworker(userId: string | null | undefined, agentId: string | null | undefined): Promise<void> {
    if (!userId || !agentId) return
    try {
        const { data } = await selectMaybeSingle(createServiceRoleClient(), 'users', ['email_notification_prefs'] as const, { id: userId })
        if (!data) return
        const prefs = normalizeNotificationPrefs(data.email_notification_prefs)
        const rule = coworkerRuleOf(prefs, agentId)
        if (rule.follow !== undefined) return
        await writeNotificationPrefs(userId, { ...prefs, coworkers: { ...prefs.coworkers, [agentId]: { ...rule, follow: true } } })
    } catch (err) {
        console.error('[notifications] failed to follow the coworker', err)
    }
}

export async function followAuthorOfCreatedTask(workspaceId: number, event: EngineCreatedEvent): Promise<void> {
    const authorId = event.metadata?.authorId
    if (event.event === 'box.connection.connected' || typeof authorId !== 'string' || !event.agentId) return
    try {
        const supabase = createServiceRoleClient()
        const [{ data: member }, { data: agent }] = await Promise.all([
            selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, user_id: authorId }),
            selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, engine_agent_id: event.agentId }),
        ])
        if (member && agent) await followCoworker(member.user_id, agent.id)
    } catch (err) {
        console.error('[notifications] failed to follow the author of a scheduled task', err)
    }
}
