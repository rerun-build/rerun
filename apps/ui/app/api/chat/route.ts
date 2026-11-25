import { actorFromContext, callableEngineAgentIds, type UserActor } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/errors'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { createSessionRow, ensureSessionRow, findGeneralSession, getExistingSession, resolveAgentTarget } from '@/app/api/_services/chat.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { requestTimeZone } from '@/lib/i18n/request-locale'
import type { Database } from '@/app/api/database.types'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { embedTextShared } from '@/lib/services/embed'
import { sendTurn } from '@/lib/chat/send-turn'
import { stripAttachmentsRef } from '@/lib/chat/attachments-marker'
import { isConversationId } from '@/lib/chat/conversation-id'
import { installSessionTitle, parseInstallMessage } from '@/lib/chat/install-marker'
import { seedSessionTitle } from '@/lib/chat/session-title'
import { preferredLanguage } from '@/lib/foreman/language'
import { stripVoiceMarker } from '@/lib/voice/marker'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { FOREMAN_AGENT_ID, SESSION_NOT_FOUND, reasoningEffortSchema, type MessageAuthor, type SessionKind, type SessionSource } from '@rerun/contracts'

type ChatRequestBody = {
    agentId?: unknown
    sessionId?: string
    text?: unknown
    connectionId?: string
    model?: string
    effort?: unknown
    source?: SessionSource
    queued?: boolean
    // `general` opens the coworker's main conversation when no `sessionId` names it yet. Read only
    // on a new conversation; an install always runs in a thread of its own.
    kind?: SessionKind
}

// A code rather than the engine's sentence: the chat turns it into a notice that opens a new
// conversation, instead of a red box quoting the engine.
const sessionNotFound = () => Response.json({ error: SESSION_NOT_FOUND }, { status: 404 })

export async function POST(request: Request) {
    // Reject unauthenticated callers up front. resolveAgentTarget below also
    // enforces that the agent belongs to this workspace (defense in depth).
    let author: MessageAuthor
    // Read once here and handed to every check below: nothing shares a read between the calls of a
    // route handler, so each one left to find the caller again would ask the database for it.
    let actor: UserActor
    let callablePromise: Promise<string[] | undefined>
    let workspaceId: number
    try {
        const ctx = await requireWorkspaceContext()
        // The zone only helps the Chief of Staff: a request it cannot be read from still sends.
        author = await messageAuthorOf(ctx, await requestTimeZone().catch(() => undefined))
        actor = actorFromContext(ctx)
        workspaceId = ctx.workspace.id
        // Read alongside the body and awaited inside the engine call's try: a failure fails the send
        // rather than letting it through with every coworker callable.
        callablePromise = callableEngineAgentIds(actor)
        callablePromise.catch(() => {})
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // A malformed body is not exceptional here: the Next proxy truncates anything over its
    // 10MB cap, and an unhandled parse error would answer 500 with an empty body, which the
    // AI SDK turns into an Error with no message at all.
    let body: ChatRequestBody
    try {
        body = await request.json()
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { agentId, connectionId, model, source, queued } = body
    // A level this hub does not know is dropped rather than refused: the message still goes, on the
    // coworker's own effort.
    const effort = reasoningEffortSchema.nullable().optional().catch(undefined).parse(body.effort)
    let { sessionId } = body

    if (typeof agentId !== 'string') {
        return Response.json({ error: 'Missing coworker id' }, { status: 400 })
    }

    const text = typeof body.text === 'string' ? body.text : ''

    if (!text) {
        return Response.json({ error: 'Missing message text' }, { status: 400 })
    }

    // Not a conversation row's id (an engine session id carried into a chat link, typically): no
    // conversation can carry it. Refused before the embedding below, which a message that is never
    // sent would only waste.
    if (sessionId && !isConversationId(sessionId)) {
        console.warn(`[CHAT SESSION INVALID] agent=${agentId} session=${sessionId}`)
        return sessionNotFound()
    }

    // The coworker will ask for the embedding of this message to recall its memories, before it calls
    // its model: asked for now, it is under way by the time the engine does.
    embedTextShared(workspaceId, text).catch(() => {})

    // The conversation the request names is looked up while the coworker is: neither read waits on
    // the other. Its failure is answered further down, where it is awaited.
    const namedSession = sessionId ? getExistingSession(sessionId, actor) : null
    namedSession?.catch(() => {})

    // The Chief of Staff is talked to on its own route, which writes its brief and keeps each
    // member's conversations apart.
    const target = await resolveAgentTarget(agentId, 'use', actor).catch(() => null)
    if (!target || target.engineAgentId === FOREMAN_AGENT_ID) {
        return Response.json({ error: 'Coworker not configured or not found' }, { status: 400 })
    }

    // A voice message carries its audio as a marker appended to the transcript; the session title
    // is about what was said, not about the file. An install is named after the setup it starts,
    // never after a summary of its guide.
    const install = parseInstallMessage(text)
    const sessionTitleSeed = install ? installSessionTitle(install.agentName) : stripVoiceMarker(stripAttachmentsRef(text))

    // A tab that opens General before anyone spoke in it has no session id: the row may still exist,
    // written by another tab or another member a moment ago, and then it is the one to continue.
    const general = body.kind === 'general' && !sessionId && !install
    if (general) {
        const existing = await findGeneralSession(agentId).catch(() => null)
        if (existing) sessionId = existing.id
    }

    // Resolve the engine session id for an existing conversation.
    let engineSessionId: string | undefined
    if (sessionId) {
        let existing: Awaited<ReturnType<typeof getExistingSession>>
        try {
            existing = await (namedSession ?? getExistingSession(sessionId, actor))
        } catch (err) {
            // Missing, in another workspace, or in a Box the caller cannot use: all the same to the
            // caller, a conversation that is not there, so the chat offers a new one instead of a retry.
            if (err instanceof AuthorizationError) return sessionNotFound()
            console.error(`[CHAT SESSION] agent=${agentId} session=${sessionId} could not be resolved:`, err)
            return Response.json({ error: 'Failed to resolve session' }, { status: 500 })
        }
        // A tab of one coworker holding another one's conversation: the engine would answer with a
        // raw 404, since the session lives in the other coworker's database.
        if (existing.agentId !== agentId) {
            console.warn(`[CHAT SESSION MISMATCH] agent=${agentId} session=${sessionId} owner=${existing.agentId}`)
            return sessionNotFound()
        }
        engineSessionId = existing.engineSessionId ?? undefined
    }

    const isNew = !sessionId
    return sendTurn({
        target,
        text,
        sender: actor,
        author,
        queued: queued === true,
        engine: async () => ({ connectionId, model, effort, source, callableAgentIds: await callablePromise, install: !!install && isNew, userLanguage: install && isNew ? (preferredLanguage(request.headers.get('accept-language')) ?? undefined) : undefined }),
        conversationId: sessionId,
        engineSessionId,
        log: `agent=${agentId}`,
        preview: install ? null : text,
        sessionGone: sessionNotFound,
        // The agent's install already runs in another conversation: the chat opens that one rather
        // than a second install. Its row is mirrored here in case the run that opened it never got
        // that far.
        answerBusy: async busy => {
            if (busy?.code !== 'install_in_flight' || !busy.sessionId || !install) return null
            const installSessionId = await ensureSessionRow(agentId, busy.sessionId, sessionTitleSeed, { source })
            return Response.json({ error: 'install_in_flight', sessionId: installSessionId }, { status: 409 })
        },
        open: async newEngineSessionId => {
            const rowId = await createSessionRow(agentId, newEngineSessionId, sessionTitleSeed, null, source, general ? 'general' : 'thread', install ? null : sessionTitleSeed)
            // General keeps its name; a thread is named after what it opens with, unless someone
            // renamed it while the title was being written.
            if (!install && !general) {
                generateSessionTitle(sessionTitleSeed)
                    .then(async title => {
                        await createServiceRoleClient().from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ title }).eq('id', rowId).eq('title', seedSessionTitle(sessionTitleSeed))
                    })
                    .catch(() => {})
            }
            return rowId
        },
    })
}
