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
}))

vi.mock('@ai-sdk/react', () => ({
    useChat: (options: { id: string; onFinish?: (finish: Finish) => void }) => {
        if (options.id.startsWith('engine-')) mocks.onFinish = options.onFinish ?? null
        return { messages: [], status: 'ready', error: undefined, setMessages: vi.fn(), sendMessage: vi.fn(), addToolResult: vi.fn(), stop: vi.fn(), resumeStream: vi.fn(), clearError: vi.fn(), regenerate: vi.fn() }
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
    function Chat() {
        useForemanChat()
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Chat)))
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
