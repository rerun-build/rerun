import { actorFromContext, keepVisible, visibleSpaceIds } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { markSessionsHandled } from '@/app/api/_services/conversation.service'
import type { Database } from '@/app/api/database.types'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { ATTENTION_NOTIFICATION_COLUMNS, attentionDetailsOf, attentionNotificationsFilter } from '@/lib/notifications/attention-details'
import { isScheduledSource } from '@/lib/notifications/prefs'
import { groupUnseenRuns } from '@/lib/notifications/unseen-runs'
import { createClient } from '@/supabase/server'
import { selectCount, selectMany } from '@/supabase/supabase-helpers'
import { ATTENTION_STATUSES, type Inbox, type InboxItem } from '@rerun/contracts'

type SessionReadInsert = Database['public']['Tables']['session_reads']['Insert']

const ATTENTION_COLUMNS = ['id', 'agent_id', 'engine_session_id', 'title', 'status', 'updated_at'] as const

// The board keeps every waiting conversation in memory; the app takes the newest, enough for a phone.
const ATTENTION_PAGE = 100

// The web's inbox in one read: the conversations waiting on the caller, then the finished runs they
// have not looked at yet, folded by scheduled task. Built from the same sources and the same rules as
// `WorkspaceInbox`, so the two cannot disagree on what is news.
export async function listWorkspaceInbox(ctx: WorkspaceContext): Promise<Inbox> {
    const [{ data: agentRows, error: agentsError }, spaces] = await Promise.all([selectMany(ctx.supabase, 'agents', ['id', 'name', 'space_id'] as const, { workspace_id: ctx.workspace.id }), visibleSpaceIds(actorFromContext(ctx))])
    if (agentsError) throw agentsError

    // A finished run of a coworker outside the caller's Boxes drops out below, its name not found.
    const namesById = new Map(keepVisible(agentRows ?? [], spaces, a => a.space_id).map(a => [a.id, a.name]))
    if (namesById.size === 0) return { items: [], running: 0 }
    const agentIds = [...namesById.keys()]

    // `unseen_runs` answers for `auth.uid()`: it runs as the caller, not through the service role.
    const asCaller = await createClient()
    const [attention, unseen, running, tErrors] = await Promise.all([
        selectMany(ctx.supabase, 'sessions', ATTENTION_COLUMNS, { agent_id: agentIds, status: [...ATTENTION_STATUSES] }, { column: 'updated_at', ascending: false }, ATTENTION_PAGE),
        asCaller.rpc('unseen_runs', { p_workspace_id: ctx.workspace.id }),
        selectCount(ctx.supabase, 'sessions', { agent_id: agentIds, status: 'working' }),
        recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id).then(locale => translatorFor(locale, 'chatErrors')),
    ])
    if (attention.error) throw attention.error
    if (unseen.error) throw unseen.error
    if (running.error) throw running.error

    const sessions = attention.data ?? []
    const filter = attentionNotificationsFilter(sessions)
    const notifications = filter ? await selectMany(ctx.supabase, 'notifications', ATTENTION_NOTIFICATION_COLUMNS, filter, { column: 'created_at', ascending: false }) : { data: [], error: null }
    if (notifications.error) throw notifications.error
    const details = attentionDetailsOf(sessions, notifications.data ?? [], ctx.userId, tErrors)

    // A row whose notification went to someone else is theirs, as on the web.
    const waiting: InboxItem[] = sessions.flatMap(session => {
        const detail = details[session.id]
        if (!detail?.reason) return []
        return [{ id: session.id, sessionId: session.id, sessionIds: [session.id], agentId: session.agent_id, agentName: namesById.get(session.agent_id) ?? 'Coworker', status: session.status as InboxItem['status'], title: detail.title, message: detail.message, updatedAt: session.updated_at, count: 1 }]
    })

    // The web names a scheduled task after the engine's schedule; the hub does not reach the engine
    // for a label, so it falls back on the slug, as the web does when the name is missing.
    const done: InboxItem[] = groupUnseenRuns(unseen.data ?? []).flatMap(group => {
        const agentName = namesById.get(group.agentId)
        if (!agentName) return []
        const scheduled = isScheduledSource(group.source) && !!group.slug
        return [{ id: `done:${group.key}`, sessionId: group.latestSessionId, sessionIds: group.sessionIds, agentId: group.agentId, agentName, status: 'done' as const, title: scheduled ? group.slug! : group.title, message: scheduled ? null : group.message, updatedAt: new Date(group.at).toISOString(), count: group.count }]
    })

    return { items: [...waiting, ...done], running: running.data ?? 0 }
}

// « Mark as read » on the web: a waiting conversation goes back to idle, a finished run is recorded as
// seen. `'all'` does both for the whole inbox.
export async function markInboxRead(ctx: WorkspaceContext, sessionIds: string[] | 'all'): Promise<void> {
    await markSessionsHandled(ctx, sessionIds)

    const asCaller = await createClient()
    let seen = sessionIds
    if (seen === 'all') {
        const { data, error } = await asCaller.rpc('unseen_runs', { p_workspace_id: ctx.workspace.id })
        if (error) throw error
        seen = (data ?? []).map(run => run.session_id)
    }
    if (seen.length === 0) return

    const { error } = await asCaller
        .from('session_reads')
        .upsert<SessionReadInsert>(
            seen.map(sessionId => ({ session_id: sessionId, user_id: ctx.userId })),
            { onConflict: 'session_id,user_id' }
        )
    if (error) throw error
}
