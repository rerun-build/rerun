import { messagePreview } from '@rerun/contracts'

import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type SessionUpdate = Database['public']['Tables']['sessions']['Update']
type Speaker = 'user' | 'agent'

function previewUpdate(text: string, from: Speaker, authorId: string | null): SessionUpdate | null {
    const preview = messagePreview(text)
    return preview ? { last_message: preview, last_message_from: from, last_message_author_id: authorId, last_message_at: new Date().toISOString() } : null
}

// What the person just sent, on their conversation's row. Best-effort: a preview never fails a send,
// and the send does not wait for it.
export async function recordSentMessage(sessionId: string, text: string, authorId: string): Promise<void> {
    try {
        const update = previewUpdate(text, 'user', authorId)
        if (!update) return
        const { error } = await createServiceRoleClient().from('sessions').update<SessionUpdate>(update).eq('id', sessionId)
        if (error) console.error('[session-preview] failed to record the sent message', error)
    } catch (err) {
        console.error('[session-preview] failed to record the sent message', err)
    }
}

// What the coworker answered, on the row of the conversation its run belongs to.
export async function recordAgentReply(agentId: string, engineSessionId: string, text: string): Promise<void> {
    try {
        const update = previewUpdate(text, 'agent', null)
        if (!update) return
        const { error } = await createServiceRoleClient().from('sessions').update<SessionUpdate>(update).eq('agent_id', agentId).eq('engine_session_id', engineSessionId)
        if (error) console.error('[session-preview] failed to record the reply', error)
    } catch (err) {
        console.error('[session-preview] failed to record the reply', err)
    }
}
