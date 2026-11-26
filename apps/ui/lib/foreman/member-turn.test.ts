import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserActor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    memberContext: vi.fn(),
    isPhoneStepPending: vi.fn(),
    engineSessionOf: vi.fn(),
    startEngineConversation: vi.fn(),
    loadForemanState: vi.fn(),
    resolveForemanSurface: vi.fn(),
    resolveAgentTarget: vi.fn(),
    sendTurn: vi.fn(),
    foremanTurnParams: vi.fn(),
}))

vi.mock('@rerun/cloud/phone.server', () => ({ isPhoneStepPending: mocks.isPhoneStepPending }))
vi.mock('@rerun/cloud/phone', () => ({ PHONE_REQUIRED_MESSAGE: 'Add your phone number first.' }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: mocks.resolveAgentTarget }))
vi.mock('@/app/api/_services/me.service', () => ({ messageAuthorOf: async () => ({ id: 'u-ada', name: 'Ada' }) }))
vi.mock('@/lib/chat/send-turn', () => ({ sendTurn: mocks.sendTurn }))
vi.mock('@/lib/services/embed', () => ({ embedTextShared: vi.fn(async () => null) }))
vi.mock('./checkin-context', () => ({ memberContext: mocks.memberContext }))
vi.mock('./conversation', () => ({ copyToShippedForemanRow: vi.fn(), engineSessionOf: mocks.engineSessionOf, startEngineConversation: mocks.startEngineConversation }))
vi.mock('./engine-turn', () => ({ foremanTurnParams: mocks.foremanTurnParams }))
vi.mock('./state', () => ({ loadForemanState: mocks.loadForemanState }))
vi.mock('./surface.server', () => ({ resolveForemanSurface: mocks.resolveForemanSurface }))

const { sendForemanTurnAsMember } = await import('./member-turn')

const ADA: UserActor = { kind: 'user', userId: 'u-ada', workspaceId: 7, role: 'member', boxScope: 'all' }
const CTX = { userId: 'u-ada', authUser: { is_anonymous: false }, workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }
const TARGET = { conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'foreman' }

function streamed(conversationId: string) {
    return new Response('data: {}\n\n', { headers: { 'X-Run-Id': 'run-cos', 'X-Session-Id': conversationId } })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.memberContext.mockResolvedValue(CTX)
    mocks.isPhoneStepPending.mockResolvedValue(false)
    mocks.loadForemanState.mockResolvedValue({ phase: 'companion' })
    mocks.resolveForemanSurface.mockResolvedValue('engine')
    mocks.resolveAgentTarget.mockResolvedValue(TARGET)
    mocks.sendTurn.mockImplementation(async (turn: { conversationId: string }) => streamed(turn.conversationId))
})

describe('sendForemanTurnAsMember', () => {
    it('opens a new thread of the member and hands back the run to wait for', async () => {
        mocks.engineSessionOf.mockResolvedValue(null)
        const turn = await sendForemanTurnAsMember(ADA, 'Plan my week')

        expect(mocks.memberContext).toHaveBeenCalledWith(7, 'u-ada')
        expect(turn).toMatchObject({ runId: 'run-cos', target: TARGET })
        const sent = mocks.sendTurn.mock.calls[0][0]
        expect(sent).toMatchObject({ text: 'Plan my week', queued: false, engineSessionId: undefined, conversationId: turn.conversationId })

        await sent.open('engine-new')
        expect(mocks.startEngineConversation).toHaveBeenCalledWith(CTX, turn.conversationId, 'engine-new', 'Plan my week', 'thread', 'api')

        await sent.engine()
        expect(mocks.foremanTurnParams).toHaveBeenCalledWith(CTX, { phase: 'companion' }, TARGET, { source: 'api' })
    })

    it('continues one of their conversations, and refuses one that is not theirs', async () => {
        mocks.engineSessionOf.mockResolvedValueOnce({ backend: 'engine', engineSessionId: 'engine-1' })
        await expect(sendForemanTurnAsMember(ADA, 'And Friday?', 'conv-1')).resolves.toMatchObject({ conversationId: 'conv-1' })
        expect(mocks.sendTurn.mock.calls[0][0]).toMatchObject({ conversationId: 'conv-1', engineSessionId: 'engine-1' })
        expect(mocks.resolveForemanSurface).not.toHaveBeenCalled()

        mocks.engineSessionOf.mockResolvedValueOnce(null)
        await expect(sendForemanTurnAsMember(ADA, 'hi', 'someone-elses')).rejects.toThrow('No conversation someone-elses of yours')
        expect(mocks.sendTurn).toHaveBeenCalledTimes(1)
    })

    it('stops where the app would: a member who left, a phone step pending, a Chief of Staff not on the machine yet', async () => {
        mocks.engineSessionOf.mockResolvedValue(null)
        mocks.memberContext.mockResolvedValueOnce(null)
        await expect(sendForemanTurnAsMember(ADA, 'hi')).rejects.toThrow('no longer in the workspace')

        mocks.isPhoneStepPending.mockResolvedValueOnce(true)
        await expect(sendForemanTurnAsMember(ADA, 'hi')).rejects.toThrow('phone number')

        mocks.resolveForemanSurface.mockResolvedValueOnce('onboarding')
        await expect(sendForemanTurnAsMember(ADA, 'hi')).rejects.toThrow('not available yet')
        expect(mocks.sendTurn).not.toHaveBeenCalled()
    })

    it('says the Chief of Staff is still answering rather than queueing behind it', async () => {
        mocks.engineSessionOf.mockResolvedValue({ backend: 'engine', engineSessionId: 'engine-1' })
        mocks.sendTurn.mockResolvedValue(Response.json({ error: 'run_in_flight', runId: 'run-0' }, { status: 409 }))
        await expect(sendForemanTurnAsMember(ADA, 'hi', 'conv-1')).rejects.toThrow('still answering')
    })

    it('never tails the run in flight, which would hand its answer back as the answer to this message', async () => {
        mocks.engineSessionOf.mockResolvedValue({ backend: 'engine', engineSessionId: 'engine-1' })
        await sendForemanTurnAsMember(ADA, 'And Friday?', 'conv-1')
        const busy = (await mocks.sendTurn.mock.calls[0][0].answerBusy({ runId: 'run-0' })) as Response
        expect(busy.status).toBe(409)
        await expect(busy.json()).resolves.toEqual({ error: 'run_in_flight', runId: 'run-0' })
    })
})
