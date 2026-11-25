'use server'

import type { Database, Json } from '@/app/api/database.types'
import { assertAgentInWorkspace, assertSessionInWorkspace, isAdminActor, requireLightSessionActor } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { conversationCopy } from '@/app/api/_services/conversation-copy.service'
import { workspaceBrand } from '@/lib/brand/workspace'
import { engineSessionOf } from '@/lib/foreman/conversation'
import { isWhiteLabel, MESSAGE_FEEDBACK_CATEGORY_VALUES, type MessageFeedbackRating } from '@rerun/contracts'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { z } from 'zod'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'

type MessageFeedbackInsert = Database['public']['Tables']['message_feedback']['Insert']
type MessageFeedbackUpdate = Database['public']['Tables']['message_feedback']['Update']

export type RateMessageResult = { ok: true; id: string } | ActionFailure
export type MessageFeedbackResult = { ok: true } | ActionFailure
export type SessionFeedbackEntry = { id: string; messageId: string; rating: MessageFeedbackRating }

// Whose conversation the id names: an agent's session, or one of the foreman's on the engine, which
// has no sessions row and is keyed on its own column.
export type FeedbackScope = 'agent' | 'foreman'

const rateSchema = z.object({
    sessionId: z.string().uuid(),
    scope: z.enum(['agent', 'foreman']).default('agent'),
    messageId: z.string().min(1).max(200),
    rating: z.enum(['up', 'down']),
    messageText: z.string().max(100_000),
})

const detailsSchema = z.object({
    id: z.string().uuid(),
    category: z.enum(MESSAGE_FEEDBACK_CATEGORY_VALUES).nullable(),
    details: z.string().trim().max(5_000),
})

// The vote lands on the click, before any details are asked for: a dialog dismissed still counts.
// The conversation is copied from the engine now, since the Box holding it may be gone by the
// time anyone reads the feedback.
export async function rateMessageAction(input: z.input<typeof rateSchema>): Promise<RateMessageResult> {
    const parsed = rateSchema.safeParse(input)
    if (!parsed.success) return failure('invalidFeedback')
    const { sessionId, scope, messageId, rating, messageText } = parsed.data

    const ctx = await requireWorkspaceContext()
    const { userId, workspace, supabase } = ctx
    // A vote copies the conversation for Rerun's team to read: never the one of an organization's client.
    if (isWhiteLabel(await workspaceBrand(workspace.id))) return failure('feedbackUnavailable')
    const owner = await conversationCopy(ctx, scope, sessionId)
    if (!owner) return failure('conversationNotFound')
    // A vote names a message of the conversation it is about, not any string: each one copies the
    // transcript with it.
    if (owner.transcript.length > 0 && !owner.transcript.some(message => (message as { id?: unknown }).id === messageId)) return failure('messageNotFound')

    const { data, error } = await supabase
        .from('message_feedback')
        .upsert<MessageFeedbackInsert>(
            {
                workspace_id: workspace.id,
                user_id: userId,
                ...owner.keys,
                message_id: messageId,
                rating,
                category: null,
                details: null,
                message_text: messageText,
                transcript: owner.transcript as unknown as Json,
                updated_at: new Date().toISOString(),
            },
            { onConflict: scope === 'foreman' ? 'foreman_conversation_id,message_id' : 'session_id,message_id' },
        )
        .select('id')
        .single()
    if (error || !data) return error ? { ok: false, error: error.message } : failure('saveFeedbackFailed')
    return { ok: true, id: data.id }
}

// A vote on a coworker's message is reached through that coworker, like its conversation. The
// foreman's have no coworker and stay the workspace's.
async function reachableFeedbackWorkspaceId(id: string): Promise<number> {
    const actor = await requireLightSessionActor()
    if (isAdminActor(actor)) return actor.workspaceId
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'message_feedback', ['agent_id'] as const, { id, workspace_id: actor.workspaceId })
    if (data?.agent_id) await assertAgentInWorkspace(data.agent_id, 'use', actor)
    return actor.workspaceId
}

export async function updateMessageFeedbackAction(input: z.input<typeof detailsSchema>): Promise<MessageFeedbackResult> {
    const parsed = detailsSchema.safeParse(input)
    if (!parsed.success) return failure('invalidFeedback')
    const { id, category, details } = parsed.data

    const workspaceId = await reachableFeedbackWorkspaceId(id).catch(() => null)
    if (workspaceId === null) return failure('feedbackNotFound')
    const { error } = await createServiceRoleClient()
        .from('message_feedback')
        .update<MessageFeedbackUpdate>({ category, details: details || null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

export async function clearMessageFeedbackAction(id: string): Promise<MessageFeedbackResult> {
    if (!z.string().uuid().safeParse(id).success) return failure('invalidFeedback')

    const workspaceId = await reachableFeedbackWorkspaceId(id).catch(() => null)
    if (workspaceId === null) return failure('feedbackNotFound')
    const { error } = await createServiceRoleClient().from('message_feedback').delete().eq('id', id).eq('workspace_id', workspaceId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

export async function fetchSessionFeedbackAction(sessionId: string, scope: FeedbackScope = 'agent'): Promise<SessionFeedbackEntry[]> {
    try {
        if (scope === 'foreman') {
            if (!(await engineSessionOf(await requireWorkspaceContext(), sessionId))) return []
        } else await assertSessionInWorkspace(sessionId)
    } catch {
        return []
    }
    const { data } = await selectMany(createServiceRoleClient(), 'message_feedback', ['id', 'message_id', 'rating'] as const, scope === 'foreman' ? { foreman_conversation_id: sessionId } : { session_id: sessionId })
    return (data ?? []).map(row => ({ id: row.id, messageId: row.message_id, rating: row.rating as MessageFeedbackRating }))
}
