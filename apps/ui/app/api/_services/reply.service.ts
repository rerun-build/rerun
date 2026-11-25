import { actorFromContext, callableEngineAgentIds, type UserActor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { claimWaitingSession, getExistingSession, recordMessageSent, resolveAgentTarget, updateSessionStatus } from '@/app/api/_services/chat.service'
import { readSessionTranscript } from '@/app/api/_services/conversation.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { ApiError } from '@/lib/api-error'
import { QUEUED_RETRY_DELAYS_MS, startChat } from '@/lib/chat/start-chat'
import { replyTextOf } from '@/lib/chat/reply-text'
import { refusal } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ENGINE_SESSION_NOT_FOUND, findPendingHitl, needsHuman, sessionStatusSchema, type ConversationReply, type ConversationReplyResult, type MessageAuthor, type SessionStatus } from '@rerun/contracts'

const alreadyAnswered = () => new ApiError(409, refusal('requestAlreadyAnswered'))

// Answers a conversation without anyone watching the stream: the run goes on on the engine, which
// keeps it apart from whoever reads it, and the person sees its end in a push or in the app.
export async function replyToConversation(ctx: WorkspaceContext, sessionId: string, reply: ConversationReply): Promise<ConversationReplyResult> {
    return replyAs(actorFromContext(ctx), await messageAuthorOf(ctx), sessionId, reply)
}

// The same answer from a caller with no browser session: the Chief of Staff answering a card in the
// name of the member it speaks for, whose author says so (`via`).
export async function replyAs(actor: UserActor, author: MessageAuthor, sessionId: string, reply: ConversationReply): Promise<ConversationReplyResult> {
    const session = await getExistingSession(sessionId, actor)
    // Without an engine session the engine would open a new conversation instead of answering this one.
    if (!session.engineSessionId) throw new ApiError(404, refusal('conversationNotFound'))
    const toolCallId = reply.toolCallId ?? null

    // A transcript still ending on a card the person closed reads as pending: the status says it is not.
    let pending: ReturnType<typeof findPendingHitl> = null
    let waitingAs: SessionStatus | null = null
    if (toolCallId) {
        const [{ data: row }, { messages }] = await Promise.all([selectMaybeSingle(createServiceRoleClient(), 'sessions', ['status'] as const, { id: session.sessionId }), readSessionTranscript(session.sessionId, actor)])
        const status = sessionStatusSchema.safeParse(row?.status)
        waitingAs = status.success && needsHuman(status.data) ? status.data : null
        pending = waitingAs ? findPendingHitl(messages) : null
        if (pending?.toolCallId !== toolCallId) throw alreadyAnswered()
    }

    const text = replyTextOf(reply, pending)
    if (!text) throw new ApiError(400, refusal('invalidRequest'))

    const [target, callableAgentIds] = await Promise.all([resolveAgentTarget(session.agentId, 'use', actor), callableEngineAgentIds(actor)])
    if (waitingAs && !(await claimWaitingSession(session.sessionId, waitingAs))) throw alreadyAnswered()
    // An answer the engine did not take gives the card back, a 409 included: were it left working
    // with no run behind it, nothing would ever move it again. A run really under way sets it itself.
    const giveBack = async () => {
        if (waitingAs) await updateSessionStatus(session.sessionId, waitingAs)
    }
    const response = await startChat(target.conn, target.engineAgentId, { sessionId: session.engineSessionId, message: text, author, callableAgentIds }, QUEUED_RETRY_DELAYS_MS).catch(async error => {
        await giveBack()
        throw error
    })
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        await giveBack()
        if (response.status === 409) throw toolCallId ? alreadyAnswered() : new ApiError(409, refusal('coworkerStillWorking'))
        if (response.status === 404 && body.includes(ENGINE_SESSION_NOT_FOUND)) throw new ApiError(404, refusal('conversationNotFound'))
        throw new ApiError(502, refusal('boxDidNotAnswer'))
    }
    void response.body?.cancel().catch(() => {})

    await recordMessageSent(session.sessionId, actor, text)
    return { runId: response.headers.get('x-run-id') }
}
