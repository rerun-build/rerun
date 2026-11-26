import 'server-only'

import { isPhoneStepPending } from '@rerun/cloud/phone.server'
import { PHONE_REQUIRED_MESSAGE } from '@rerun/cloud/phone'
import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { actorFromContext, type UserActor } from '@/app/api/_auth/access'
import { resolveAgentTarget, type AgentChatTarget } from '@/app/api/_services/chat.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { sendTurn } from '@/lib/chat/send-turn'
import { randomUuid } from '@/lib/random-uuid'
import { embedTextShared } from '@/lib/services/embed'
import { memberContext } from './checkin-context'
import { copyToShippedForemanRow, engineSessionOf, startEngineConversation } from './conversation'
import { foremanTurnParams } from './engine-turn'
import { loadForemanState } from './state'
import { resolveForemanSurface } from './surface.server'

export type MemberForemanTurn = { target: AgentChatTarget; runId: string; conversationId: string }

// A message to the Chief of Staff from outside the app, in the name of one member: the turn their
// chat would send, in a conversation of their own (a new thread, or one of theirs to continue).
// Nothing streams back: the caller reads the run once it ends.
export async function sendForemanTurnAsMember(actor: UserActor, message: string, conversationId?: string): Promise<MemberForemanTurn> {
    const ctx = await memberContext(actor.workspaceId, actor.userId)
    if (!ctx || ctx.authUser.is_anonymous) throw new Error('The member who created this key is no longer in the workspace.')
    if (await isPhoneStepPending(ctx.supabase, ctx.userId)) throw new Error(PHONE_REQUIRED_MESSAGE)

    const existing = conversationId ? await engineSessionOf(ctx, conversationId) : null
    if (conversationId && !existing) throw new Error(`No conversation ${conversationId} of yours with the Chief of Staff. list_conversations with agentId "${FOREMAN_AGENT_ID}" gives them.`)
    if (existing?.backend === 'hub') throw new Error('This conversation with the Chief of Staff predates its move to the machine and is read only. Start a new one: leave sessionId out.')

    const state = await loadForemanState(ctx, null)
    if (!existing && (await resolveForemanSurface(ctx.workspace.id, state, { canClaim: true })) !== 'engine') throw new Error('The Chief of Staff of this workspace is not available yet: finish the onboarding in the Rerun app first.')

    embedTextShared(ctx.workspace.id, message).catch(() => {})
    const target = await resolveAgentTarget(FOREMAN_AGENT_ID, 'use', actorFromContext(ctx))
    const sessionId = conversationId ?? randomUuid()

    const res = await sendTurn({
        target,
        text: message,
        sender: ctx,
        author: await messageAuthorOf(ctx),
        queued: false,
        engine: () => foremanTurnParams(ctx, state, target, { source: 'api' }),
        conversationId: sessionId,
        engineSessionId: existing?.engineSessionId ?? undefined,
        log: 'agent=foreman source=api',
        preview: message,
        // Tailing the run in flight, as the browser's chat does, would hand back that run's answer
        // as the answer to this message, and drop this one.
        answerBusy: async busy => Response.json({ error: 'run_in_flight', runId: busy?.runId ?? null }, { status: 409 }),
        open: async engineSessionId => {
            await startEngineConversation(ctx, sessionId, engineSessionId, message, 'thread', 'api')
            return sessionId
        },
        recorded: copyToShippedForemanRow,
    })

    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        if (body?.error === 'run_in_flight') throw new Error('The Chief of Staff is still answering in this conversation. Wait for that run with get_run, or start a new conversation.')
        throw new Error(body?.error ?? `The Chief of Staff could not be reached (${res.status}).`)
    }
    const runId = res.headers.get('x-run-id')
    // The engine buffers the run on its side: leaving the stream reads as one reader leaving.
    await res.body?.cancel().catch(() => {})
    if (!runId) throw new Error('The engine accepted the message but did not return a run id.')
    return { target, runId, conversationId: res.headers.get('x-session-id') ?? sessionId }
}
