import { actorFromContext, callableEngineAgentIds } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { createSessionRow, ensureSessionRow, findGeneralSession, GeneralAlreadyOpenError, getAgentChatTarget, getExistingSession, updateSessionStatus } from '@/app/api/_services/chat.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { recordSessionParticipant, recordSessionRead } from '@/app/api/_services/notification-audience.service'
import type { Database } from '@/app/api/database.types'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { cancelRun, reconnectRun } from '@/lib/engine/client'
import { QUEUED_RETRY_DELAYS_MS, startChat } from '@/lib/chat/start-chat'
import { stripAttachmentsRef } from '@/lib/chat/attachments-marker'
import { installSessionTitle, parseInstallMessage } from '@/lib/chat/install-marker'
import { preferredLanguage } from '@/lib/foreman/language'
import { stripVoiceMarker } from '@/lib/voice/marker'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { ENGINE_SESSION_NOT_FOUND, SESSION_NOT_FOUND, type MessageAuthor, type SessionKind, type SessionSource } from '@moldwright/contracts'

type ChatRequestBody = {
    agentId?: unknown
    sessionId?: string
    text?: unknown
    connectionId?: string
    model?: string
    source?: SessionSource
    queued?: boolean
    kind?: SessionKind
}

const sessionNotFound = () => Response.json({ error: SESSION_NOT_FOUND }, { status: 404 })

export async function POST(request: Request) {
    let author: MessageAuthor
    let callablePromise: Promise<string[] | undefined>
    try {
        const ctx = await requireWorkspaceContext()
        author = messageAuthorOf(ctx)
        callablePromise = callableEngineAgentIds(actorFromContext(ctx))
        callablePromise.catch(() => {})
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: ChatRequestBody
    try {
        body = await request.json()
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { agentId, connectionId, model, source, queued } = body
    let { sessionId } = body

    if (typeof agentId !== 'string') {
        return Response.json({ error: 'Missing coworker id' }, { status: 400 })
    }

    const text = typeof body.text === 'string' ? body.text : ''

    if (!text) {
        return Response.json({ error: 'Missing message text' }, { status: 400 })
    }

    const target = await getAgentChatTarget(agentId).catch(() => null)
    if (!target) {
        return Response.json({ error: 'Coworker not configured or not found' }, { status: 400 })
    }

    const install = parseInstallMessage(text)
    const sessionTitleSeed = install ? installSessionTitle(install.agentName) : stripVoiceMarker(stripAttachmentsRef(text))

    const general = body.kind === 'general' && !sessionId && !install
    if (general) {
        const existing = await findGeneralSession(agentId).catch(() => null)
        if (existing) sessionId = existing.id
    }

    let engineSessionId: string | undefined
    if (sessionId) {
        let existing: Awaited<ReturnType<typeof getExistingSession>>
        try {
            existing = await getExistingSession(sessionId)
        } catch {
            return Response.json({ error: 'Failed to resolve session' }, { status: 500 })
        }
        if (existing.agentId !== agentId) {
            console.warn(`[CHAT SESSION MISMATCH] agent=${agentId} session=${sessionId} owner=${existing.agentId}`)
            return sessionNotFound()
        }
        engineSessionId = existing.engineSessionId ?? undefined
    }

    let engineRes!: Response
    let supabaseSessionId!: string
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            console.log(`[CHAT START] agent=${agentId} session=${sessionId ?? '(new)'} inputLength=${text.length}${queued ? ' queued' : ''}`)
            engineRes = await startChat(target.conn, target.engineAgentId, { sessionId: engineSessionId, message: text, connectionId, model, source, author, callableAgentIds: await callablePromise, install: !!install && !sessionId, userLanguage: install && !sessionId ? (preferredLanguage(request.headers.get('accept-language')) ?? undefined) : undefined }, queued ? QUEUED_RETRY_DELAYS_MS : null)
        } catch (err) {
            return Response.json({ error: `Engine error: ${err instanceof Error ? err.message : 'Failed to start chat'}` }, { status: 502 })
        }

        if (engineRes.status === 409) {
            const busy = (await engineRes.json().catch(() => null)) as { code?: string; sessionId?: string; runId?: string; startedAt?: string | null; authorId?: string | null } | null
            if (busy?.code === 'install_in_flight' && busy.sessionId && install) {
                const installSessionId = await ensureSessionRow(agentId, busy.sessionId, sessionTitleSeed, { source })
                return Response.json({ error: 'install_in_flight', sessionId: installSessionId }, { status: 409 })
            }
            console.warn(`[CHAT BUSY] agent=${agentId} session=${sessionId ?? '(new)'} run=${busy?.runId ?? '?'} input=${JSON.stringify(text.slice(0, 200))}`)
            const heldByTeammate = Boolean(busy?.authorId) && busy?.authorId !== author.id
            const busyResponse = () => Response.json({ error: 'run_in_flight', runId: busy?.runId ?? null, startedAt: busy?.startedAt ?? null, heldByTeammate }, { status: 409 })
            if (queued || heldByTeammate || !busy?.runId || attempt > 0) return busyResponse()
            engineRes = await reconnectRun(target.conn, target.engineAgentId, busy.runId).catch(() => new Response(null, { status: 204 }))
            if (engineRes.status === 204 || !engineRes.ok || !engineRes.body) {
                return busyResponse()
            }
            const headers = new Headers()
            headers.set('Content-Type', engineRes.headers.get('content-type') ?? 'text/event-stream')
            headers.set('x-vercel-ai-ui-message-stream', engineRes.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1')
            if (sessionId) headers.set('X-Session-Id', sessionId)
            headers.set('X-Run-Id', busy.runId)
            return new Response(engineRes.body, { headers })
        }

        if (!engineRes.ok || !engineRes.body) {
            const errBody = await engineRes.text().catch(() => '')
            if (engineRes.status === 404 && errBody.includes(ENGINE_SESSION_NOT_FOUND)) {
                console.warn(`[CHAT SESSION GONE] agent=${agentId} session=${sessionId ?? '(new)'} engineSession=${engineSessionId ?? '?'}`)
                return sessionNotFound()
            }
            return Response.json({ error: `Engine error: ${engineRes.status} ${errBody}` }, { status: 502 })
        }

        const resolvedEngineSessionId = engineRes.headers.get('x-session-id') ?? engineSessionId

        if (!sessionId) {
            if (!resolvedEngineSessionId) {
                return Response.json({ error: 'Engine did not return a session id' }, { status: 502 })
            }
            try {
                supabaseSessionId = await createSessionRow(agentId, resolvedEngineSessionId, sessionTitleSeed, null, source, general ? 'general' : 'thread', install ? null : sessionTitleSeed)
            } catch (err) {
                if (err instanceof GeneralAlreadyOpenError && attempt === 0) {
                    console.warn(`[CHAT GENERAL RACE] agent=${agentId} orphan=${resolvedEngineSessionId} general=${err.general.engineSessionId}`)
                    void engineRes.body?.cancel().catch(() => {})
                    const orphanRunId = engineRes.headers.get('x-run-id')
                    if (orphanRunId) void cancelRun(target.conn, target.engineAgentId, orphanRunId).catch(() => {})
                    sessionId = err.general.id
                    engineSessionId = err.general.engineSessionId
                    continue
                }
                return Response.json({ error: 'Failed to persist session' }, { status: 500 })
            }
            if (!install && !general) {
                generateSessionTitle(sessionTitleSeed)
                    .then(async title => {
                        const supabase = createServiceRoleClient()
                        await supabase.from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ title }).eq('id', supabaseSessionId)
                    })
                    .catch(() => {})
            }
        } else {
            supabaseSessionId = sessionId
            if (resolvedEngineSessionId && resolvedEngineSessionId !== engineSessionId) {
                const supabase = createServiceRoleClient()
                await supabase.from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ engine_session_id: resolvedEngineSessionId }).eq('id', supabaseSessionId).then()
            }
        }
        break
    }

    await updateSessionStatus(supabaseSessionId, 'working')
    await Promise.all([recordSessionParticipant(supabaseSessionId, author.id), recordSessionRead(supabaseSessionId, author.id)])

    const headers = new Headers()
    headers.set('Content-Type', engineRes.headers.get('content-type') ?? 'text/event-stream')
    headers.set('x-vercel-ai-ui-message-stream', engineRes.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1')
    headers.set('X-Session-Id', supabaseSessionId)
    const runId = engineRes.headers.get('x-run-id')
    if (runId) headers.set('X-Run-Id', runId)

    return new Response(engineRes.body, { headers })
}
