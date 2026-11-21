import { callableEngineAgentIds } from '@/app/api/_auth/access'
import { createSessionRow, findGeneralSession, GeneralAlreadyOpenError, recordMessageSent, resolveAgentTarget, getExistingSession } from '@/app/api/_services/chat.service'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { embedTextShared } from '@/lib/services/embed'
import { buildInstallMessage } from '@/lib/chat/install-marker'
import * as engine from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

vi.mock('@/lib/i18n/request-locale', () => ({ requestTimeZone: vi.fn(async () => 'Europe/Paris') }))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn().mockResolvedValue({ userId: 'me', workspace: { id: 7 }, authUser: { app_metadata: {}, user_metadata: {} } }) }))
vi.mock('@/lib/services/embed', () => ({ embedTextShared: vi.fn().mockResolvedValue(null) }))
vi.mock('@/app/api/_auth/access', () => ({ actorFromContext: vi.fn(() => ({ kind: 'user', userId: 'me', workspaceId: 7, role: 'member', boxScope: 'assigned' })), callableEngineAgentIds: vi.fn() }))
vi.mock('@/app/api/_services/notification-audience.service', () => ({ recordSessionParticipant: vi.fn(), recordSessionRead: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_services/chat.service')>()),
    resolveAgentTarget: vi.fn(),
    getExistingSession: vi.fn(),
    createSessionRow: vi.fn(),
    findGeneralSession: vi.fn(),
    recordMessageSent: vi.fn(),
}))
vi.mock('@/app/api/_services/session-preview.service', () => ({ recordSentMessage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn().mockResolvedValue('Title') }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ chat: vi.fn(), reconnectRun: vi.fn(), cancelRun: vi.fn().mockResolvedValue(undefined) }))

const busy = () => Response.json({ runId: 'run-1', startedAt: null }, { status: 409 })
const streaming = (runId: string, sessionId = 'engine-session') => new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream', 'x-run-id': runId, 'x-session-id': sessionId } })

const SESSION = '4dfbb571-8f9a-4ff2-810c-11e414cb8569'

function request(body: Record<string, unknown>) {
    return new Request('https://rerun.test/api/chat', { method: 'POST', body: JSON.stringify({ agentId: 'agent', sessionId: SESSION, text: 'ship it', ...body }) })
}

// The route sleeps between retries; without fake timers the queued cases would take 25 seconds.
async function settle(response: Promise<Response>): Promise<Response> {
    await vi.runAllTimersAsync()
    return response
}

describe('POST /api/chat', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ engineAgentId: 'engine-agent', conn: { baseUrl: 'https://engine.test', apiKey: null } })
        vi.mocked(getExistingSession).mockResolvedValue({ sessionId: SESSION, agentId: 'agent', engineSessionId: 'engine-session' })
        vi.mocked(callableEngineAgentIds).mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('answers not found, without a lookup, for an engine session id sent as the conversation', async () => {
        const response = await POST(request({ sessionId: '3ovpbq4znpvo17t1in2bs' }))

        expect(response.status).toBe(404)
        expect(getExistingSession).not.toHaveBeenCalled()
        expect(engine.chat).not.toHaveBeenCalled()
    })

    it('hands the caller it read once to the checks on the coworker and on the conversation', async () => {
        vi.mocked(engine.chat).mockImplementation(async () => streaming('run-1'))

        await settle(POST(request({})))

        const actor = { kind: 'user', userId: 'me', workspaceId: 7, role: 'member', boxScope: 'assigned' }
        expect(resolveAgentTarget).toHaveBeenCalledWith('agent', actor)
        expect(getExistingSession).toHaveBeenCalledWith(SESSION, actor)
    })

    it('asks for the embedding of the message as it comes in, for the recall the coworker runs before its model', async () => {
        vi.mocked(engine.chat).mockImplementation(async () => streaming('run-1'))

        await settle(POST(request({})))

        expect(embedTextShared).toHaveBeenCalledWith(7, 'ship it')
    })

    it('sends the message even when that embedding fails', async () => {
        vi.mocked(embedTextShared).mockRejectedValueOnce(new Error('provider away'))
        vi.mocked(engine.chat).mockImplementation(async () => streaming('run-1'))

        expect((await settle(POST(request({})))).status).toBe(200)
    })

    it('hands a queued message back rather than tailing the run holding the conversation', async () => {
        vi.mocked(engine.chat).mockImplementation(async () => busy())

        const response = await settle(POST(request({ queued: true })))

        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ error: 'run_in_flight', runId: 'run-1' })
        expect(engine.reconnectRun).not.toHaveBeenCalled()
        expect(vi.mocked(engine.chat).mock.calls.length).toBeGreaterThan(1)
    })

    it('sends a queued message as soon as the engine releases the session', async () => {
        vi.mocked(engine.chat).mockImplementationOnce(async () => busy()).mockImplementationOnce(async () => streaming('run-2'))

        const response = await settle(POST(request({ queued: true })))

        expect(response.status).toBe(200)
        expect(response.headers.get('X-Run-Id')).toBe('run-2')
        expect(engine.chat).toHaveBeenCalledTimes(2)
    })

    it('still tails the run in flight for a message that was not queued', async () => {
        vi.mocked(engine.chat).mockImplementation(async () => busy())
        vi.mocked(engine.reconnectRun).mockResolvedValue(streaming('run-1'))

        const response = await settle(POST(request({})))

        expect(response.status).toBe(200)
        expect(response.headers.get('X-Run-Id')).toBe('run-1')
        expect(engine.chat).toHaveBeenCalledTimes(1)
        expect(engine.reconnectRun).toHaveBeenCalledOnce()
    })

    it('hands the engine the coworkers the author reaches', async () => {
        vi.mocked(callableEngineAgentIds).mockResolvedValue(['engine-agent', 'engine-other'])
        vi.mocked(engine.chat).mockImplementation(async () => streaming('run-3'))

        const response = await settle(POST(request({})))

        expect(response.status).toBe(200)
        expect(vi.mocked(engine.chat).mock.calls[0][2]).toMatchObject({ callableAgentIds: ['engine-agent', 'engine-other'] })
    })

    it('hands the engine the reasoning effort picked with the model, and drops one it does not know', async () => {
        vi.mocked(engine.chat).mockImplementation(async () => streaming('run-4'))

        await settle(POST(request({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'high' })))
        await settle(POST(request({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: null })))
        await settle(POST(request({ connectionId: 'claude-1', model: 'claude-opus-5-5', effort: 'extreme' })))
        await settle(POST(request({})))

        const sent = vi.mocked(engine.chat).mock.calls.map(call => call[2])
        expect(sent[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
        expect(sent[1]).toMatchObject({ effort: null })
        expect(sent[2].effort).toBeUndefined()
        // Nothing picked: the body the engine gets is the one it got before the setting existed.
        expect(JSON.parse(JSON.stringify(sent[3]))).not.toHaveProperty('effort')
    })

    it('refuses the send when what the author reaches cannot be read, rather than opening every coworker', async () => {
        vi.mocked(callableEngineAgentIds).mockRejectedValue(new Error('database down'))

        const response = await settle(POST(request({})))

        expect(response.status).toBe(502)
        expect(engine.chat).not.toHaveBeenCalled()
    })

    it('refuses a conversation of another coworker without reaching the engine', async () => {
        vi.mocked(getExistingSession).mockResolvedValue({ sessionId: SESSION, agentId: 'other-agent', engineSessionId: 'other-engine-session' })

        const response = await settle(POST(request({})))

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'session_not_found' })
        expect(engine.chat).not.toHaveBeenCalled()
    })

    it('answers the engine refusing a session it does not hold with the same code, not its raw text', async () => {
        vi.mocked(engine.chat).mockResolvedValue(Response.json({ error: 'session not found for this agent' }, { status: 404 }))

        const response = await settle(POST(request({})))

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'session_not_found' })
    })

    describe('General', () => {
        beforeEach(() => {
            vi.mocked(engine.chat).mockImplementation(async () => streaming('run-4'))
            vi.mocked(createSessionRow).mockResolvedValue('general-row')
            vi.mocked(findGeneralSession).mockResolvedValue(null)
        })

        it('opens the coworker\'s General on the first message, under its fixed name', async () => {
            const response = await settle(POST(request({ sessionId: undefined, kind: 'general' })))

            expect(response.status).toBe(200)
            expect(response.headers.get('X-Session-Id')).toBe('general-row')
            expect(createSessionRow).toHaveBeenCalledWith('agent', 'engine-session', 'ship it', null, undefined, 'general', 'ship it')
            expect(generateSessionTitle).not.toHaveBeenCalled()
        })

        it('continues the General another tab already opened rather than creating a second one', async () => {
            vi.mocked(findGeneralSession).mockResolvedValue({ id: 'general-row', engineSessionId: 'engine-general' })
            vi.mocked(getExistingSession).mockResolvedValue({ sessionId: 'general-row', agentId: 'agent', engineSessionId: 'engine-general' })
            vi.mocked(engine.chat).mockImplementation(async () => streaming('run-4', 'engine-general'))

            const response = await settle(POST(request({ sessionId: undefined, kind: 'general' })))

            expect(response.status).toBe(200)
            expect(response.headers.get('X-Session-Id')).toBe('general-row')
            expect(vi.mocked(engine.chat).mock.calls[0][2]).toMatchObject({ sessionId: 'engine-general' })
            expect(createSessionRow).not.toHaveBeenCalled()
        })

        it('starts over on the General another tab opened between the lookup and the insert', async () => {
            vi.mocked(createSessionRow).mockRejectedValue(new GeneralAlreadyOpenError({ id: 'general-row', engineSessionId: 'engine-general' }))
            vi.mocked(engine.chat).mockImplementationOnce(async () => streaming('run-4', 'engine-orphan')).mockImplementationOnce(async () => streaming('run-5', 'engine-general'))

            const response = await settle(POST(request({ sessionId: undefined, kind: 'general' })))

            expect(response.status).toBe(200)
            expect(response.headers.get('X-Session-Id')).toBe('general-row')
            expect(response.headers.get('X-Run-Id')).toBe('run-5')
            expect(vi.mocked(engine.chat).mock.calls.map(call => call[2].sessionId)).toEqual([undefined, 'engine-general'])
            expect(engine.cancelRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'run-4')
            expect(createSessionRow).toHaveBeenCalledTimes(1)
        })

        it('hands the message back when the General that won is still answering the other tab', async () => {
            vi.mocked(createSessionRow).mockRejectedValue(new GeneralAlreadyOpenError({ id: 'general-row', engineSessionId: 'engine-general' }))
            vi.mocked(engine.chat).mockImplementationOnce(async () => streaming('run-4', 'engine-orphan')).mockImplementationOnce(async () => busy())

            const response = await settle(POST(request({ sessionId: undefined, kind: 'general' })))

            expect(response.status).toBe(409)
            expect(await response.json()).toMatchObject({ error: 'run_in_flight', runId: 'run-1' })
            expect(engine.reconnectRun).not.toHaveBeenCalled()
            expect(engine.cancelRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'run-4')
        })

        it('names a thread after its first message, as before, and keeps that message for General', async () => {
            const response = await settle(POST(request({ sessionId: undefined })))

            expect(response.status).toBe(200)
            expect(createSessionRow).toHaveBeenCalledWith('agent', 'engine-session', 'ship it', null, undefined, 'thread', 'ship it')
            expect(generateSessionTitle).toHaveBeenCalledWith('ship it')
        })

        it('writes the generated title only on a thread still named after its first message', async () => {
            const db = fakeSupabase()
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client)

            await settle(POST(request({ sessionId: undefined })))

            const [write] = db.writes('sessions')
            expect(write.payload).toEqual({ title: 'Title' })
            expect(write.filters.map(call => call.args)).toEqual([
                ['id', 'general-row'],
                ['title', 'ship it'],
            ])
        })
    })

    describe('preview of the last message', () => {
        it('keeps what the person sent on their conversation, for the list of coworkers', async () => {
            vi.mocked(engine.chat).mockResolvedValue(streaming('run-3'))

            const response = await settle(POST(request({})))

            expect(response.status).toBe(200)
            expect(recordMessageSent).toHaveBeenCalledWith(SESSION, 'me', 'ship it')
        })

        it('keeps nothing of an install, which opens with its guide', async () => {
            vi.mocked(engine.chat).mockResolvedValue(streaming('run-4'))
            vi.mocked(createSessionRow).mockResolvedValue('new-session')

            await settle(POST(request({ sessionId: undefined, text: buildInstallMessage('Set up the coworker', 'Scout') })))

            expect(recordMessageSent).toHaveBeenCalledWith('new-session', 'me', null)
        })

        it('keeps nothing when the engine refuses the message', async () => {
            vi.mocked(engine.chat).mockResolvedValue(new Response('boom', { status: 500 }))

            const response = await settle(POST(request({})))

            expect(response.status).toBe(502)
            expect(recordMessageSent).not.toHaveBeenCalled()
        })
    })
})
