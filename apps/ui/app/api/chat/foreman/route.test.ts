import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { isPhoneStepPending } from '@rerun/cloud/phone.server'
import { logRerunUsage } from '@rerun/cloud/billing.server'
import { saveForemanConversation } from '@/lib/foreman/conversation'
import { prepareScript } from '@/lib/foreman/scripted'
import { loadForemanState } from '@/lib/foreman/state'
import { createForemanTurn } from '@/lib/foreman/turn'
import { PHONE_REQUIRED_MESSAGE } from '@rerun/cloud/phone'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BILLING_ENABLED } from '@rerun/cloud/billing'
import { POST } from './route'

vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: vi.fn() }))
vi.mock('@rerun/cloud/phone.server', () => ({ isPhoneStepPending: vi.fn() }))
vi.mock('@rerun/cloud/billing.server', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/billing.server')>()), logRerunUsage: vi.fn() }))
vi.mock('@/lib/foreman/conversation', () => ({ engineSessionOf: vi.fn().mockResolvedValue(null), loadForemanConversation: vi.fn(), saveForemanConversation: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/foreman/state', () => ({ loadForemanState: vi.fn() }))
vi.mock('@/lib/foreman/scripted', () => ({ prepareScript: vi.fn(), runScript: vi.fn() }))
vi.mock('@/lib/foreman/tools', () => ({ foremanActiveTools: vi.fn(() => []), foremanTools: vi.fn(() => ({})) }))
vi.mock('@/lib/foreman/turn', () => ({ createForemanTurn: vi.fn() }))
vi.mock('@/lib/foreman/prompt', () => ({ foremanSystemPrompt: vi.fn() }))

const request = (messages: unknown[] = [], client?: string) => new Request('https://rerun.test/api/chat/foreman', { method: 'POST', body: JSON.stringify({ sessionId: 'session', messages, client }) })
const hello = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]

describe('POST /api/chat/foreman', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('RERUN_MAX_API_KEY', 'key')
        vi.mocked(requireWorkspaceContext).mockResolvedValue({ userId: 'user-1', authUser: { is_anonymous: false }, workspace: { id: 7 }, supabase: {} } as never)
        vi.mocked(loadForemanState).mockResolvedValue({ phase: 'waitlist' } as never)
    })

    it('turns away an account that still owes its phone number before reading where the workspace stands', async () => {
        vi.mocked(isPhoneStepPending).mockResolvedValue(true)

        const response = await POST(request())

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: PHONE_REQUIRED_MESSAGE })
        expect(loadForemanState).not.toHaveBeenCalled()
    })

    it('lets an account that owes nothing through to the foreman', async () => {
        vi.mocked(isPhoneStepPending).mockResolvedValue(false)

        const response = await POST(request())

        expect(response.status).toBe(423)
        expect(loadForemanState).toHaveBeenCalledOnce()
    })

    it.each([
        ['ios', 'ios'],
        ['android', 'android'],
        [undefined, 'web'],
        ['windows', 'web'],
    ])('walks a conversation the client %s opened as %s', async (client, walkedAs) => {
        vi.mocked(isPhoneStepPending).mockResolvedValue(false)
        await POST(request([], client))
        expect(loadForemanState).toHaveBeenCalledWith(expect.anything(), null, null, walkedAs)
    })

    describe('a turn the model answers', () => {
        const frames = [
            { id: 'gen', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }] },
            { id: 'gen', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 4, cost: 0.003 } },
        ]
        const openRouterStream = () => new Response(`${frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })

        beforeEach(() => {
            vi.mocked(isPhoneStepPending).mockResolvedValue(false)
            vi.mocked(loadForemanState).mockResolvedValue({ phase: 'plan', answers: {} } as never)
            vi.mocked(prepareScript).mockResolvedValue(null as never)
            vi.mocked(createForemanTurn).mockReturnValue({ state: () => ({ phase: 'plan', foreman: {} }) } as never)
        })

        afterEach(() => vi.restoreAllMocks())

        // The onboarding is on the house: there is no credit to check, so none can run out on it.
        it('reaches the model without asking how much credit the workspace has left', async () => {
            const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => openRouterStream())

            const response = await POST(request(hello))
            await response.text()

            expect(response.status).toBe(200)
            expect(fetchMock).toHaveBeenCalledOnce()
        })

        it.skipIf(!BILLING_ENABLED)('logs what the turn cost without taking it off the credit', async () => {
            vi.spyOn(globalThis, 'fetch').mockImplementation(async () => openRouterStream())

            await (await POST(request(hello))).text()

            expect(logRerunUsage).toHaveBeenCalledWith({ workspaceId: 7, model: 'openai/gpt-6-sol', tier: 'smart', inputTokens: 120, outputTokens: 4, costMicros: 3000 })
        })

        // Two answers once streamed over each other in the browser, which sent the transcript back
        // with every copy: the turn reads and saves each of them once.
        it('saves a transcript whose answers were pushed twice with each answer once', async () => {
            vi.spyOn(globalThis, 'fetch').mockImplementation(async () => openRouterStream())
            const doubled = [...hello, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }, { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'Hey' }] }, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] }, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Again' }] }]

            await (await POST(request(doubled))).text()
            await vi.waitFor(() => expect(saveForemanConversation).toHaveBeenCalledOnce())

            const [, , transcript] = vi.mocked(saveForemanConversation).mock.calls[0]
            expect(transcript.map(message => message.id).slice(0, 4)).toEqual(['m1', 'a', 'b', 'u2'])
            expect(transcript[1].parts).toEqual([{ type: 'text', text: 'Hi there' }])
        })
    })
})
