// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunReconnectTarget } from '@/hooks/useRunReconnect'

// A model the Chief of Staff gave a coworker shows without a reload however its turn ended (RER-284).

type Finish = { message: { parts: unknown[] }; isAbort: boolean; isDisconnect: boolean; isError: boolean }

const mocks = vi.hoisted(() => ({
    reReadAgentsChangedBy: vi.fn(),
    onFinish: null as ((finish: Finish) => void) | null,
    reconnect: null as (() => RunReconnectTarget | null) | null,
    engineMessages: [] as { id: string; role: string; parts: unknown[] }[],
    regenerateEngine: vi.fn(),
}))

vi.mock('@ai-sdk/react', () => ({
    useChat: (options: { id: string; onFinish?: (finish: Finish) => void }) => {
        const engine = options.id.startsWith('engine-')
        if (engine) mocks.onFinish = options.onFinish ?? null
        return { messages: engine ? mocks.engineMessages : [], status: 'ready', error: undefined, setMessages: vi.fn(), sendMessage: vi.fn(), addToolResult: vi.fn(), stop: vi.fn(), resumeStream: vi.fn(), clearError: vi.fn(), regenerate: engine ? mocks.regenerateEngine : vi.fn() }
    },
}))
vi.mock('@/hooks/useRunReconnect', () => ({
    useRunReconnect: ({ start }: { start: () => RunReconnectTarget | null }) => {
        mocks.reconnect = start
        return false
    },
}))
vi.mock('@/hooks/useAgentContext', () => ({ reReadAgentsChangedBy: mocks.reReadAgentsChangedBy }))
vi.mock('@/hooks/useTranscriptCatchUp', () => ({ useTranscriptCatchUp: () => {} }))
vi.mock('@/hooks/useWorkspaceConnections', () => ({ refreshWorkspaceConnections: vi.fn() }))
vi.mock('@/components/foreman/useForemanKickoff', () => ({ refreshForemanSurface: vi.fn() }))
vi.mock('@/components/foreman/foremanClientTools', () => ({ isForemanClientTool: () => false, runForemanClientTool: vi.fn() }))
vi.mock('@/app/api/_actions/agent.actions', () => ({ getRunAction: vi.fn() }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: null, refreshPhoneStep: vi.fn() }), useIsWorkspaceAdmin: () => true }))

const { useForemanChat } = await import('@/components/foreman/useForemanChat')
const { useForemanStore } = await import('@/stores/foreman.store')

const UPDATE = { type: 'tool-update_agent', toolName: 'update_agent', toolCallId: 'c1', state: 'output-available', input: { agentId: 'morning' }, output: {} }

let root: Root | null = null

async function mountChat() {
    const chat = { current: null as ReturnType<typeof useForemanChat> | null }
    function Chat() {
        chat.current = useForemanChat()
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Chat)))
    return chat
}

describe('useForemanChat re-reading the coworkers a turn changed', () => {
    beforeEach(() => mocks.reReadAgentsChangedBy.mockReset())
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        vi.unstubAllGlobals()
    })

    it.each([
        ['ended', {}],
        ['was stopped', { isAbort: true }],
        ['lost its stream', { isDisconnect: true, isError: true }],
        ['failed', { isError: true }],
    ])('re-reads them when the turn %s', async (_, how) => {
        await mountChat()
        act(() => mocks.onFinish!({ message: { parts: [UPDATE] }, isAbort: false, isDisconnect: false, isError: false, ...how }))
        expect(mocks.reReadAgentsChangedBy).toHaveBeenCalledWith([UPDATE])
    })

    it('re-reads them from the last turn of the transcript when the run ended while the stream was down', async () => {
        const answer = { type: 'text', text: 'Done.' }
        const earlier = { ...UPDATE, toolCallId: 'c0', input: { agentId: 'odin' } }
        const messages = [
            { id: '1', role: 'user', parts: [] },
            { id: '2', role: 'assistant', parts: [earlier] },
            { id: '3', role: 'user', parts: [] },
            { id: '4', role: 'assistant', parts: [UPDATE] },
            { id: '5', role: 'assistant', parts: [answer] },
        ]
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages }))))
        await mountChat()
        act(() => useForemanStore.getState().setEngineRunId('run-1'))
        expect(await mocks.reconnect!()!.fetchMessages()).toEqual(messages)
        expect(mocks.reReadAgentsChangedBy).toHaveBeenCalledWith([UPDATE, answer])
    })
})

// A turn read back from the engine is one message per step: aimed at its last step, the SDK's
// regenerate sends an empty text and the hub answers 400 "Missing message text" (RER-222).
describe('useForemanChat regenerating a turn read back from the engine', () => {
    beforeEach(() => {
        mocks.regenerateEngine.mockReset()
        mocks.engineMessages = [
            { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Install Ubersuggest too' }] },
            { id: 'u1-step1', role: 'assistant', parts: [] },
            { id: 'u1-step2', role: 'assistant', parts: [] },
            { id: 'u1-step3', role: 'assistant', parts: [] },
        ]
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        mocks.engineMessages = []
    })

    it('retries the failed turn from its user message', async () => {
        const chat = await mountChat()
        act(() => chat.current!.retryLastTurn())
        expect(mocks.regenerateEngine).toHaveBeenCalledWith({ messageId: 'u1' })
    })

    it('regenerates a step from the user message of its turn', async () => {
        const chat = await mountChat()
        act(() => chat.current!.regenerate('u1-step2'))
        expect(mocks.regenerateEngine).toHaveBeenCalledWith({ messageId: 'u1' })
    })
})
