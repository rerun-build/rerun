import 'server-only'

import { ENGINE_SESSION_NOT_FOUND, type MessageAuthor } from '@rerun/contracts'

import { GeneralAlreadyOpenError, recordMessageSent, type AgentChatTarget } from '@/app/api/_services/chat.service'
import type { Database } from '@/app/api/database.types'
import { cancelRun, reconnectRun } from '@/lib/engine/client'
import { QUEUED_RETRY_DELAYS_MS, startChat, type ChatParams } from '@/lib/chat/start-chat'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export type EngineBusy = { code?: string; sessionId?: string; runId?: string; startedAt?: string | null; authorId?: string | null }

// One message sent to a coworker, the Chief of Staff included: the steps every kind takes, with the
// few that differ handed in by its route (the Chief of Staff's brief rides in `engine`).
export type Turn = {
    target: AgentChatTarget
    text: string
    author: MessageAuthor
    queued: boolean
    // Read as the turn starts: a part that cannot be read (what the author reaches) fails the send
    // rather than letting it through.
    engine: () => Promise<Omit<ChatParams, 'sessionId' | 'message' | 'author'>>
    // The row the message lands in, when it is known before the engine answers.
    conversationId: string | undefined
    // The engine session it continues; none opens a new one, and `open` writes its row.
    engineSessionId: string | undefined
    // Throws GeneralAlreadyOpenError when another tab opened General first.
    open: (engineSessionId: string) => Promise<string>
    // What the line under the coworker shows of this message, null for nobody's message.
    preview: string | null
    // A 409 its route answers itself (an install already running elsewhere).
    answerBusy?: (busy: EngineBusy | null) => Promise<Response | null>
    sessionGone?: () => Response
    // Once the engine took the turn, before the row is written.
    started?: () => Promise<void>
    // Once the row says the message was sent.
    recorded?: (conversationId: string) => Promise<void>
    log: string
}

function stream(engineRes: Response, conversationId: string | undefined, runId: string | null): Response {
    const headers = new Headers()
    headers.set('Content-Type', engineRes.headers.get('content-type') ?? 'text/event-stream')
    headers.set('x-vercel-ai-ui-message-stream', engineRes.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1')
    if (conversationId) headers.set('X-Session-Id', conversationId)
    if (runId) headers.set('X-Run-Id', runId)
    return new Response(engineRes.body, { headers })
}

export async function sendTurn(turn: Turn): Promise<Response> {
    const { target, text, author, queued } = turn
    let { conversationId, engineSessionId } = turn
    let engineRes!: Response
    let rowId!: string
    let started = false
    let engineParams: Awaited<ReturnType<Turn['engine']>>
    try {
        engineParams = await turn.engine()
    } catch (err) {
        return Response.json({ error: `Engine error: ${err instanceof Error ? err.message : 'Failed to start chat'}` }, { status: 502 })
    }
    // Two passes at most: when another tab opened General between the lookup and the insert, the
    // message is sent again on the General that won.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            console.log(`[CHAT START] ${turn.log} session=${conversationId ?? '(new)'} inputLength=${text.length}${queued ? ' queued' : ''}`)
            engineRes = await startChat(target.conn, target.engineAgentId, { ...engineParams, sessionId: engineSessionId, message: text, author }, queued ? QUEUED_RETRY_DELAYS_MS : null)
        } catch (err) {
            return Response.json({ error: `Engine error: ${err instanceof Error ? err.message : 'Failed to start chat'}` }, { status: 502 })
        }

        // The engine allows a single live run per conversation. A 409 means this send raced one that
        // is already under way, nearly always the same answer delivered twice by an interactive block.
        // Tail the run in flight instead of starting a second one: the caller gets a normal stream, and
        // the duplicate text is dropped on purpose (it would only repeat what the agent is answering).
        if (engineRes.status === 409) {
            const busy = (await engineRes.json().catch(() => null)) as EngineBusy | null
            const answered = await turn.answerBusy?.(busy)
            if (answered) return answered
            console.warn(`[CHAT BUSY] ${turn.log} session=${conversationId ?? '(new)'} run=${busy?.runId ?? '?'} input=${JSON.stringify(text.slice(0, 200))}`)
            // `run_in_flight` rather than a sentence: the chat turns it into a notice with a Stop
            // button and puts the text back in the composer. A run a teammate started is answering
            // their message, not this one: tailing it would drop text nobody has read, so the chat
            // queues it behind that run instead.
            const heldByTeammate = Boolean(busy?.authorId) && busy?.authorId !== author.id
            const busyResponse = () => Response.json({ error: 'run_in_flight', runId: busy?.runId ?? null, startedAt: busy?.startedAt ?? null, heldByTeammate }, { status: 409 })
            // A queued message carries text nobody has read yet, so it is never dropped: the chat puts
            // it back in the queue. The same goes for a message sent again on the General that won a
            // race: the run it meets there answers the other tab's text, not a copy of this one.
            if (queued || heldByTeammate || !busy?.runId || attempt > 0) return busyResponse()
            const tail = await reconnectRun(target.conn, target.engineAgentId, busy.runId).catch(() => null)
            if (!tail || tail.status === 204 || !tail.ok || !tail.body) return busyResponse()
            return stream(tail, conversationId, busy.runId)
        }

        if (!engineRes.ok || !engineRes.body) {
            const errBody = await engineRes.text().catch(() => '')
            if (engineRes.status === 404 && turn.sessionGone && errBody.includes(ENGINE_SESSION_NOT_FOUND)) {
                console.warn(`[CHAT SESSION GONE] ${turn.log} session=${conversationId ?? '(new)'} engineSession=${engineSessionId ?? '?'}`)
                return turn.sessionGone()
            }
            return Response.json({ error: `Engine error: ${engineRes.status} ${errBody}` }, { status: 502 })
        }

        if (!started) {
            started = true
            await turn.started?.()
        }

        // The engine returns the (possibly newly created) session id as a header.
        const resolvedEngineSessionId = engineRes.headers.get('x-session-id') ?? engineSessionId
        if (!engineSessionId) {
            if (!resolvedEngineSessionId) return Response.json({ error: 'Engine did not return a session id' }, { status: 502 })
            try {
                rowId = await turn.open(resolvedEngineSessionId)
            } catch (err) {
                // Another tab opened General a moment ago: the run just started belongs to no row. It is
                // cancelled, and the message starts over on the General that won.
                if (err instanceof GeneralAlreadyOpenError && attempt === 0) {
                    console.warn(`[CHAT GENERAL RACE] ${turn.log} orphan=${resolvedEngineSessionId} general=${err.general.engineSessionId}`)
                    void engineRes.body.cancel().catch(() => {})
                    const orphanRunId = engineRes.headers.get('x-run-id')
                    if (orphanRunId) void cancelRun(target.conn, target.engineAgentId, orphanRunId).catch(() => {})
                    conversationId = err.general.id
                    engineSessionId = err.general.engineSessionId
                    continue
                }
                return Response.json({ error: 'Failed to persist session' }, { status: 500 })
            }
        } else {
            rowId = conversationId as string
            if (resolvedEngineSessionId && resolvedEngineSessionId !== engineSessionId) {
                await createServiceRoleClient().from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ engine_session_id: resolvedEngineSessionId }).eq('id', rowId).then()
            }
        }
        break
    }

    await recordMessageSent(rowId, author.id, turn.preview)
    await turn.recorded?.(rowId)
    return stream(engineRes, rowId, engineRes.headers.get('x-run-id'))
}
