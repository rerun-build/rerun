import { FOREMAN_AGENT_ID, reasoningEffortSchema, type SessionKind } from '@rerun/contracts'

import { actorFromContext, callableEngineAgentIds } from '@/app/api/_auth/access'
import { resolveAgentTarget, type AgentChatTarget } from '@/app/api/_services/chat.service'
import { sendTurn } from '@/lib/chat/send-turn'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { isPhoneStepPending } from '@rerun/cloud/phone.server'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { requestTimeZone } from '@/lib/i18n/request-locale'
import { getWorkspaceConnection, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { embedTextShared } from '@/lib/services/embed'
import { cancelRun, supportsForemanVault } from '@/lib/engine/client'
import { cancelForemanSessionRuns, copyToShippedForemanRow, engineSessionOf, findForemanGeneral, loadForemanConversation, loadForemanConversationById, startEngineConversation } from '@/lib/foreman/conversation'
import { foremanEngineBrief } from '@/lib/foreman/engine-brief'
import { isKickoffText } from '@/lib/foreman/kickoff-marker'
import { readAnswers, writeAnswers } from '@/lib/foreman/profile'
import { mintForemanHubToken } from '@/lib/foreman/hub-token'
import { loadForemanState } from '@/lib/foreman/state'
import { resolveForemanSurface } from '@/lib/foreman/surface.server'
import { PHONE_REQUIRED_MESSAGE } from '@rerun/cloud/phone'

// The foreman of every workspace past its onboarding, running on the workspace's engine. The loop,
// the model and the transcript are the engine's; the hub only hands it, on every turn, the
// instructions and the tools of where the workspace stands now, then pipes the stream back as it
// does for an agent. The model is picked as
// for an agent, a Claude or Codex subscription included, which the hub cannot reach.

type EngineForemanBody = { sessionId?: unknown; text?: unknown; connectionId?: unknown; model?: unknown; effort?: unknown; queued?: unknown; kind?: unknown }

function requestedKind(kind: unknown): SessionKind | null {
    return kind === 'general' || kind === 'thread' ? kind : null
}

async function authorize(): Promise<Awaited<ReturnType<typeof requireWorkspaceContext>> | Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (ctx.authUser.is_anonymous) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    return ctx
}

export async function POST(req: Request): Promise<Response> {
    const ctx = await authorize()
    if (ctx instanceof Response) return ctx
    if (await isPhoneStepPending(ctx.supabase, ctx.userId)) return Response.json({ error: PHONE_REQUIRED_MESSAGE }, { status: 403 })

    let body: EngineForemanBody
    try {
        body = (await req.json()) as EngineForemanBody
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    let sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!sessionId || !text) return Response.json({ error: 'Missing session id or message' }, { status: 400 })
    // Like a coworker, the foreman recalls its memories with the embedding of this message before it
    // calls its model: asked for now, it is under way by the time the engine does.
    embedTextShared(ctx.workspace.id, text).catch(() => {})
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId : undefined
    const model = typeof body.model === 'string' ? body.model : undefined
    const effort = reasoningEffortSchema.nullable().optional().catch(undefined).parse(body.effort)
    const queued = body.queued === true

    // The zone only helps the Chief of Staff: a request it cannot be read from still sends.
    const timezone = await requestTimeZone().catch(() => undefined)
    let existing = await engineSessionOf(ctx, sessionId)
    if (existing?.backend === 'hub') return Response.json({ error: 'hub_conversation' }, { status: 409 })

    const state = await loadForemanState(ctx, req.headers.get('accept-language'))
    if (!existing && (await resolveForemanSurface(ctx.workspace.id, state, { canClaim: true })) !== 'engine') return Response.json({ error: 'foreman_unavailable' }, { status: 409 })

    // The first words the welcome page left owed: said once, and spent only once the engine took the
    // turn, so a machine that was not answering yet leaves them owed for the next load.
    const greeting = isKickoffText(text)
    if (greeting && !state.answers.onboarding?.greetPending) return Response.json({ error: 'greeting_spent' }, { status: 409 })

    // A new conversation is a thread unless the client opens General. A client older than threads
    // names neither: its first conversation becomes General, every later one a thread. A General
    // someone already spoke in is continued, whatever id the client made up for it.
    let kind: SessionKind = 'thread'
    if (!existing) {
        const general = await findForemanGeneral(ctx).catch(() => null)
        kind = requestedKind(body.kind) ?? (general ? 'thread' : 'general')
        if (kind === 'general' && general) {
            sessionId = general.id
            existing = { backend: 'engine', engineSessionId: general.engineSessionId }
        }
    }

    let target: AgentChatTarget
    try {
        target = await resolveAgentTarget(FOREMAN_AGENT_ID, 'use', actorFromContext(ctx))
    } catch (err) {
        // The machine went away under a conversation that was already going: the browser hides the
        // foreman, which only exists beside a machine.
        if (err instanceof NoEngineError) return Response.json({ error: 'foreman_unavailable' }, { status: 409 })
        return Response.json({ error: `Engine error: ${err instanceof Error ? err.message : 'Failed to start chat'}` }, { status: 502 })
    }

    return sendTurn({
        target,
        text,
        author: messageAuthorOf(ctx, timezone),
        queued,
        // Its brief is written by the hub on every turn: the instructions and the tools of where the
        // workspace stands now, with a token that carries this member's rights.
        engine: async () => ({ connectionId, model, effort, source: 'dashboard', foreman: { ...foremanEngineBrief(state, { greeting, vault: await supportsForemanVault(target.conn) }), hubToken: mintForemanHubToken(ctx.workspace.id, ctx.userId) ?? undefined }, callableAgentIds: await callableEngineAgentIds(actorFromContext(ctx)) }),
        conversationId: sessionId,
        engineSessionId: existing?.engineSessionId ?? undefined,
        log: 'agent=foreman',
        preview: greeting ? null : text,
        // The first words the welcome page left owed are spent once the engine took the turn.
        started: async () => {
            if (!greeting) return
            const answers = await readAnswers(ctx)
            await writeAnswers(ctx, { ...answers, onboarding: { ...answers.onboarding, greetPending: false } }, false)
        },
        open: async engineSessionId => {
            await startEngineConversation(ctx, sessionId, engineSessionId, text, kind)
            return sessionId
        },
        recorded: copyToShippedForemanRow,
    })
}

// The conversation the column opens on: this person's General on the engine. With a session id,
// that conversation, General or a thread, with its transcript and the run still going in it.
export async function GET(req: Request): Promise<Response> {
    const ctx = await authorize()
    if (ctx instanceof Response) return ctx

    // A transcript that cannot be read, the machine asleep or gone, is not an error the column can
    // act on: it opens empty.
    const sessionId = new URL(req.url).searchParams.get('sessionId')
    if (sessionId) {
        const conversation = await loadForemanConversationById(ctx, sessionId).catch(err => {
            console.error('[foreman] failed to read the engine conversation:', err)
            return null
        })
        // `messages` stays at the top for the clients that only ever read the transcript here.
        return Response.json(conversation ?? { messages: [] })
    }

    const conversation = await loadForemanConversation(ctx, 'engine').catch(err => {
        console.error('[foreman] failed to read the engine conversation:', err)
        return null
    })
    return Response.json(conversation)
}

// Stop. Closing the stream alone would leave the run going on the engine, still spending credit on
// an answer nobody reads.
export async function DELETE(req: Request): Promise<Response> {
    const ctx = await authorize()
    if (ctx instanceof Response) return ctx

    const params = new URL(req.url).searchParams
    const runId = params.get('runId')
    const sessionId = params.get('sessionId')
    if (!runId && !sessionId) return Response.json({ error: 'Missing run id' }, { status: 400 })

    try {
        // The session goes first: cancelling a run frees the conversation on the engine, and a message
        // waiting behind it starts its own run at once. Listed after that, the new run would be swept
        // away too. The run this tab streamed is then stopped by name, which also works on an engine
        // that cannot list the foreman's runs yet.
        if (sessionId) await cancelForemanSessionRuns(ctx, sessionId).catch(err => (runId ? undefined : Promise.reject(err)))
        if (runId) await cancelRun(await getWorkspaceConnection(ctx.workspace.id), FOREMAN_AGENT_ID, runId)
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Failed to stop the run' }, { status: 502 })
    }
    return Response.json({ ok: true })
}
