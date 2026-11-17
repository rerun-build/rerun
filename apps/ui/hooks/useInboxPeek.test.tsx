// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ peekPendingRequestAction: vi.fn(), sendSessionMessage: vi.fn(), sendForemanThreadMessage: vi.fn() }))
vi.mock('@/app/api/_actions/session.actions', () => ({ peekPendingRequestAction: mocks.peekPendingRequestAction }))
vi.mock('@/lib/chat/send-session-message', () => ({ sendSessionMessage: mocks.sendSessionMessage, sendForemanThreadMessage: mocks.sendForemanThreadMessage }))
vi.mock('@/lib/notifications/open-conversation', () => ({ resolveSessionId: async () => null }))
vi.mock('@/hooks/useAgentModel', () => ({ useAgentModel: () => ({ selection: {} }) }))

const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { useInboxPeek } = await import('./useInboxPeek')

type Hook = ReturnType<typeof useInboxPeek>

const APPROVAL_CALL = { type: 'tool-request_approval', toolCallId: 'call-1', toolName: 'request_approval', state: 'input-available', input: { approvals: [{ action: 'Send the weekly report' }] } }
const transcript = { messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'Ready to send.' }, APPROVAL_CALL] }] }

let container: HTMLDivElement
let root: Root
let seen: Hook

function Probe({ agentId, enabled, onRender }: { agentId: string; enabled: boolean; onRender: (hook: Hook) => void }) {
    onRender(useInboxPeek({ agentId, sessionId: 'session-1', engineSessionId: null }, enabled))
    return null
}

async function render(agentId: string, enabled = true) {
    await act(async () => root.render(createElement(Probe, { agentId, enabled, onRender: hook => (seen = hook) })))
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(transcript))
    )
})

afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('useInboxPeek', () => {
    it('reads nothing while held off', async () => {
        await render('closer', false)
        expect(seen.peek.state).toBe('loading')
        expect(mocks.peekPendingRequestAction).not.toHaveBeenCalled()
    })

    it('reads a Chief of Staff thread through its own route and answers it there', async () => {
        mocks.sendForemanThreadMessage.mockResolvedValue('sent')
        await render(FOREMAN_AGENT_ID)
        expect(fetch).toHaveBeenCalledWith('/api/chat/foreman/engine?sessionId=session-1')
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
        mocks.peekPendingRequestAction.mockResolvedValue({ pending: { kind: 'approval', toolCallId: 'call-1', input: APPROVAL_CALL.input }, ask: 'Ready.', before: null })
        await render('closer')
        expect(mocks.peekPendingRequestAction).toHaveBeenCalledWith('session-1')
        expect(fetch).not.toHaveBeenCalled()
        expect(seen.peek.state).toBe('ready')
    })
})
