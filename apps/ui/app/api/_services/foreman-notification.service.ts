import 'server-only'

import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME } from '@rerun/contracts'

import { memberActor, visibleSpaceIds } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { pushNotification } from '@rerun/cloud/email'
import type { NotificationPayload } from '@/lib/engine/types'
import { completionStatus, isRunCompletion, storedKind, type StoredNotification } from '@/lib/notifications/inbound'
import { computeRecipients, type RoutedEvent } from '@/lib/notifications/routing'
import { setForemanConversationStatus } from '@/lib/foreman/conversation'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
type ConversationInsert = Database['public']['Tables']['foreman_conversations']['Insert']
type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

const WAKE_TITLE = 'Check-in'
const MESSAGE_MAX = 2000

// The run of the Chief of Staff the box started on its own reaches one member, the one the hub chose
// for it. The engine names them; with the box's key a process could name anyone, so they are read
// back here: a member of the workspace who sees every Box, or nobody.
async function wakeMember(workspaceId: number, payload: NotificationPayload): Promise<string | null> {
    const memberId = payload.metadata?.memberId
    if (typeof memberId !== 'string' || !memberId) return null
    const actor = await memberActor(workspaceId, memberId)
    if (!actor || (await visibleSpaceIds(actor)) !== 'all') return null
    return memberId
}

// The conversation a wake speaks in, created the first time it has something to say: a wake that
// stays silent leaves nothing anywhere.
async function ensureWakeConversation(supabase: ServiceRoleClient, workspaceId: number, memberId: string, engineSessionId: string): Promise<string | null> {
    const { data: existing } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id'] as const, { workspace_id: workspaceId, engine_session_id: engineSessionId })
    if (existing) return existing.id
    const { data, error } = await supabase
        .from('foreman_conversations')
        .insert<ConversationInsert>({ workspace_id: workspaceId, user_id: memberId, backend: 'engine', engine_session_id: engineSessionId, kind: 'thread', title: WAKE_TITLE, status: 'working' })
        .select('id')
        .single()
    if (!error) return data.id
    // Two events of the same wake landing together: the other one created it.
    const { data: raced } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id'] as const, { workspace_id: workspaceId, engine_session_id: engineSessionId })
    return raced?.id ?? null
}

// What a wake has to say: a card it stopped on (question, approval), a notify_user, or the note it
// ended on. Its end without a word, an error and a stop are no news.
function newsOf(payload: NotificationPayload): StoredNotification | null {
    const kind = storedKind(payload)
    if (!kind) return null
    if (payload.event === 'agent.notification') return { ...payload, kind }
    if (!isRunCompletion(payload.event) || kind !== 'done' || payload.metadata?.status === 'cancelled') return null
    const said = typeof payload.metadata?.finalText === 'string' ? payload.metadata.finalText.trim() : ''
    return said ? { ...payload, kind: 'info', message: said.slice(0, MESSAGE_MAX) } : null
}

export async function recordForemanWakeEvent(engine: { workspaceId: number; isSandbox: boolean }, payload: NotificationPayload): Promise<void> {
    if (payload.event === 'agent.session.created' || !payload.sessionId) return
    const supabase = createServiceRoleClient()
    const memberId = await wakeMember(engine.workspaceId, payload)
    if (!memberId) {
        console.warn('[foreman] wake event for no member it may reach, ignored', { workspaceId: engine.workspaceId, event: payload.event })
        return
    }

    const news = newsOf(payload)
    if (!news) {
        // A conversation it already opened (a card, a heads-up) leaves its "working" state.
        const kind = storedKind(payload)
        if (kind && isRunCompletion(payload.event)) await setForemanConversationStatus(engine.workspaceId, payload.sessionId, 'idle')
        return
    }

    const conversationId = await ensureWakeConversation(supabase, engine.workspaceId, memberId, payload.sessionId)
    if (!conversationId) return
    // A note it ended on waits to be read, like a heads-up.
    const status = news.event === 'agent.notification' ? completionStatus(news) : 'awaiting_ack'
    if (status) await setForemanConversationStatus(engine.workspaceId, payload.sessionId, status)

    const { data: prefsRow } = await selectMaybeSingle(supabase, 'users', ['email_notification_prefs'] as const, { id: memberId })
    const members = [{ id: memberId, prefs: prefsRow?.email_notification_prefs ?? null }]
    const event: RoutedEvent = { agentId: FOREMAN_AGENT_ID, kind: news.kind, source: 'wake', authorId: memberId, participantIds: [memberId] }
    const recipients = computeRecipients(event, members)
    if (!recipients[memberId]) return

    const { error } = await supabase.from('notifications').insert<NotificationInsert>({
        workspace_id: engine.workspaceId,
        space_id: null,
        agent_id: null,
        engine_agent_id: FOREMAN_AGENT_ID,
        engine_session_id: payload.sessionId,
        engine_run_id: payload.runId ?? null,
        event: news.event,
        kind: news.kind,
        source: 'wake',
        message: news.message,
        metadata: (news.metadata ?? null) as unknown as NotificationInsert['metadata'],
        recipients: recipients as unknown as NotificationInsert['recipients'],
        notified_at: news.timestamp,
    })
    if (error) {
        console.error('[foreman] failed to store the notification of a wake', error)
        return
    }
    if (!engine.isSandbox) await pushNotification(supabase, { workspaceId: engine.workspaceId, agentId: FOREMAN_AGENT_ID, agentName: FOREMAN_DISPLAY_NAME, conversationId, sourceKey: `foreman:${payload.sessionId}`, notification: news, recipients, members })
}
