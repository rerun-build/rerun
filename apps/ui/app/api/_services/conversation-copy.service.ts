import { actorFromContext, assertSessionInWorkspace } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { readSessionMessages } from '@/app/api/_services/conversation.service'
import { engineSessionOf, readForemanEngineMessages } from '@/lib/foreman/conversation'

// Whose conversation the id names: a coworker's session, or one of the Chief of Staff's on the
// engine, which has no sessions row and is keyed on its own column.
export type ConversationScope = 'agent' | 'foreman'

export type ConversationCopy = {
    keys: { agent_id?: string; session_id?: string; foreman_conversation_id?: string }
    transcript: unknown[]
}

// The conversation copied from the engine now, for a row the team reads later, when the Box holding
// it may be gone. Throws when the caller cannot reach a coworker's session; null for a Chief of
// Staff conversation that is not theirs or not on the engine.
export async function conversationCopy(ctx: WorkspaceContext, scope: ConversationScope, id: string): Promise<ConversationCopy | null> {
    if (scope === 'foreman') {
        if ((await engineSessionOf(ctx, id))?.backend !== 'engine') return null
        const transcript = await readForemanEngineMessages(ctx, id).catch(() => [])
        return { keys: { foreman_conversation_id: id }, transcript }
    }
    const session = await assertSessionInWorkspace(id, actorFromContext(ctx))
    const transcript = await readSessionMessages(id).catch(() => [])
    return { keys: { agent_id: session.agent_id, session_id: id }, transcript }
}
