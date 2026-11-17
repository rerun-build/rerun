// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ peekPendingRequestAction: vi.fn(), peekForemanPendingRequestAction: vi.fn(), sendSessionMessage: vi.fn(), sendForemanThreadMessage: vi.fn() }))
vi.mock('@/app/api/_actions/session.actions', () => ({ peekPendingRequestAction: mocks.peekPendingRequestAction }))
vi.mock('@/app/api/_actions/foreman-conversation.actions', () => ({ peekForemanPendingRequestAction: mocks.peekForemanPendingRequestAction }))
vi.mock('@/lib/chat/send-session-message', () => ({ sendSessionMessage: mocks.sendSessionMessage, sendForemanThreadMessage: mocks.sendForemanThreadMessage }))
vi.mock('@/lib/notifications/open-conversation', () => ({ resolveSessionId: async () => null }))
vi.mock('@/hooks/useAgentModel', () => ({ useAgentModel: () => ({ selection: {} }) }))
vi.mock('@/stores/foreman.store', () => ({ useForemanStore: (select: (state: { agentRowId: string }) => unknown) => select({ agentRowId: 'chief-of-staff-row' }) }))

const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { useInboxPeek } = await import('./useInboxPeek')

type Hook = ReturnType<typeof useInboxPeek>

const approvalPeek = (toolCallId = 'call-1') => ({ pending: { kind: 'approval', toolCallId, input: { approvals: [{ action: 'Send the weekly report' }] } }, ask: 'Ready to send.', before: null })

let container: HTMLDivElement
let root: Root
let seen: Hook

function Probe({ agentId, enabled, revision, onRender }: { agentId: string; enabled: boolean; revision?: string; onRender: (hook: Hook) => void }) {
    onRender(useInboxPeek({ agentId, sessionId: 'session-1', engineSessionId: null }, enabled, revision))
    return null
}

async function render(agentId: string, enabled = true, revision?: string) {
    await act(async () => root.render(createElement(Probe, { agentId, enabled, revision, onRender: hook => (seen = hook) })))
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
})

describe('useInboxPeek', () => {
    it('reads nothing while held off', async () => {
        await render('closer', false)
        expect(seen.peek.state).toBe('loading')
        expect(mocks.peekPendingRequestAction).not.toHaveBeenCalled()
    })

    it('takes the row of the Chief of Staff, which its chat names it by, for the Chief of Staff', async () => {
        mocks.peekForemanPendingRequestAction.mockResolvedValue(approvalPeek())
        mocks.sendForemanThreadMessage.mockResolvedValue('sent')
        await render('chief-of-staff-row')
        expect(mocks.peekForemanPendingRequestAction).toHaveBeenCalledWith('session-1')
        await act(async () => {
            await seen.answer('APPROVED')
        })
        expect(mocks.sendForemanThreadMessage).toHaveBeenCalled()
        expect(mocks.sendSessionMessage).not.toHaveBeenCalled()
    })

    it('reads a Chief of Staff thread through its own action and answers it on its own route', async () => {
        mocks.peekForemanPendingRequestAction.mockResolvedValue(approvalPeek())
        mocks.sendForemanThreadMessage.mockResolvedValue('sent')
        await render(FOREMAN_AGENT_ID)
        expect(mocks.peekForemanPendingRequestAction).toHaveBeenCalledWith('session-1')
        expect(seen.peek).toMatchObject({ state: 'ready', sessionId: 'session-1', peek: { pending: { kind: 'approval', toolCallId: 'call-1' }, ask: 'Ready to send.' } })

        let outcome: string | undefined
        await act(async () => {
            outcome = await seen.answer('APPROVED')
        })
        expect(outcome).toBe('sent')
        expect(mocks.sendForemanThreadMessage).toHaveBeenCalledWith({ sessionId: 'session-1', text: 'APPROVED', model: {} })
        expect(mocks.peekPendingRequestAction).not.toHaveBeenCalled()
        expect(mocks.sendSessionMessage).not.toHaveBeenCalled()
    })

    it("reads a coworker's thread through the session action", async () => {
        mocks.peekPendingRequestAction.mockResolvedValue(approvalPeek())
        await render('closer')
        expect(mocks.peekPendingRequestAction).toHaveBeenCalledWith('session-1')
        expect(mocks.peekForemanPendingRequestAction).not.toHaveBeenCalled()
        expect(seen.peek.state).toBe('ready')
    })

    it('reads again when the conversation has moved, even if it never stopped waiting', async () => {
        mocks.peekPendingRequestAction.mockResolvedValueOnce(approvalPeek('call-1')).mockResolvedValueOnce(approvalPeek('call-2'))
        await render('closer', true, '2026-11-17T10:00:00Z')
        expect(seen.peek).toMatchObject({ peek: { pending: { toolCallId: 'call-1' } } })

        await render('closer', true, '2026-11-17T10:00:00Z')
        expect(mocks.peekPendingRequestAction).toHaveBeenCalledTimes(1)

        await render('closer', true, '2026-11-17T10:05:00Z')
        expect(mocks.peekPendingRequestAction).toHaveBeenCalledTimes(2)
        expect(seen.peek).toMatchObject({ peek: { pending: { toolCallId: 'call-2' } } })
    })
})
