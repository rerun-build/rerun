import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { clearLocalCache, saveTranscript } from '@/data/local-cache'

import type { ChatEndpoints } from './endpoints'
import { useCoworkerChat } from './useCoworkerChat'

const mockChat = {
    initialStatus: 'streaming',
    setStatus: (_status: string) => {},
    reconnected: () => {},
    streamEnded: () => {},
    stop: jest.fn(async (): Promise<void> => mockChat.setStatus('ready')),
    resumeStream: jest.fn(
        () =>
            new Promise<void>(resolve => {
                mockChat.reconnected = () => mockChat.setStatus('submitted')
                mockChat.streamEnded = resolve
            })
    ),
    setMessages: jest.fn(),
    clearError: jest.fn(),
    initialMessages: undefined as unknown,
    messages: [] as unknown[],
    resumeOntoRef: { current: null } as { current: string | null },
    reconnectFailedRef: { current: false } as { current: boolean },
}

const mockGrace = { module: null as null | { begin: jest.Mock<Promise<number>, []>; end: jest.Mock<Promise<boolean>, []> } }

jest.mock('@ai-sdk/react', () => {
    const { useState } = jest.requireActual<typeof import('react')>('react')
    return {
        useChat: ({ messages }: { messages?: unknown[] }) => {
            mockChat.initialMessages = messages
            const [status, setStatus] = useState(mockChat.initialStatus)
            mockChat.setStatus = setStatus
            return { messages: mockChat.messages, status, error: undefined, clearError: mockChat.clearError, setMessages: mockChat.setMessages, resumeStream: mockChat.resumeStream, stop: mockChat.stop, sendMessage: jest.fn(), regenerate: jest.fn() }
        },
    }
})
jest.mock('@/chat/transport', () => ({
    createChatTransport: ({ resumeOntoRef, reconnectFailedRef }: { resumeOntoRef: { current: string | null }; reconnectFailedRef: { current: boolean } }) => {
        mockChat.resumeOntoRef = resumeOntoRef
        mockChat.reconnectFailedRef = reconnectFailedRef
        return {}
    },
}))
jest.mock('@/chat/background-grace', () => ({
    get BackgroundGrace() {
        return mockGrace.module
    },
}))
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))

let appStateListener: (state: AppStateStatus) => void = () => {}

function fakeEndpoints(activeRunId: string | null): ChatEndpoints {
    return {
        agentId: 'agent-1',
        sendPath: '/api/chat',
        sendBody: () => ({}),
        bornSessionOf: () => null,
        messages: jest.fn(async () => []),
        activeRun: jest.fn(async () => activeRunId),
        stop: jest.fn(async () => {}),
        fileOwner: () => ({ kind: 'agent', agentId: 'agent-1' }),
    }
}

async function openConversation(endpoints: ChatEndpoints, initialSessionId: string | null = 's1') {
    const rendered = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId }))
    await act(async () => {})
    jest.clearAllMocks()
    return rendered
}

describe('useCoworkerChat in the background', () => {
    beforeEach(() => {
        mockChat.initialStatus = 'streaming'
        mockChat.reconnected = () => {}
        mockChat.streamEnded = () => {}
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListener = listener as (state: AppStateStatus) => void
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })

    it('lets go of an open stream on the way out, without stopping the run, and stays busy', async () => {
        const endpoints = fakeEndpoints(null)
        const { result } = await openConversation(endpoints)

        await act(async () => appStateListener('background'))

        expect(mockChat.stop).toHaveBeenCalledTimes(1)
        expect(endpoints.stop).not.toHaveBeenCalled()
        expect(endpoints.messages).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(true)
    })

    it('picks the run up again on return when it still goes on, busy all the way through the reconnect', async () => {
        const endpoints = fakeEndpoints('run-2')
        const { result } = await openConversation(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(endpoints.messages).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 's1')
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(result.current.busy).toBe(true)

        await act(async () => mockChat.reconnected())

        expect(result.current.status).toBe('submitted')
        expect(result.current.busy).toBe(true)
        expect(result.current.error).toBeUndefined()
    })

    it('lets go on return when the reconnect finds no stream left', async () => {
        const { result } = await openConversation(fakeEndpoints('run-2'))

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))
        await act(async () => mockChat.streamEnded())

        expect(result.current.busy).toBe(false)
    })

    it('shows the stored transcript on return when the run has ended', async () => {
        const stored = [{ id: 'm1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'done' }] }]
        const endpoints = fakeEndpoints(null)
        endpoints.messages = jest.fn(async () => stored)
        const { result } = await openConversation(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(mockChat.setMessages).toHaveBeenCalledWith(stored)
        expect(mockChat.resumeStream).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(false)
    })

    it('leaves a conversation with nothing streaming alone on the way out', async () => {
        mockChat.initialStatus = 'ready'
        const { result } = await openConversation(fakeEndpoints(null))

        await act(async () => appStateListener('background'))

        expect(mockChat.stop).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(false)
    })

    it('keeps the stream of a conversation not born yet: its id only comes with the response', async () => {
        mockChat.initialStatus = 'submitted'
        const { result } = await openConversation(fakeEndpoints(null), null)

        await act(async () => appStateListener('background'))

        expect(mockChat.stop).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(true)
    })
})

describe('useCoworkerChat with a kept transcript', () => {
    const kept = [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hello' }] }]

    beforeEach(() => {
        clearLocalCache()
        mockChat.initialStatus = 'ready'
        jest.clearAllMocks()
    })

    it('opens on it at once, then takes the hub copy without redrawing what did not change', async () => {
        saveTranscript(7, 's1', kept)
        const endpoints = fakeEndpoints(null)
        endpoints.messages = jest.fn(async () => kept)

        const { result } = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))

        expect(mockChat.initialMessages).toEqual(kept)
        expect(result.current.history).toBe('ready')
        await act(async () => {})
        expect(endpoints.messages).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 's1')
        expect(result.current.fresh).toBe(true)
    })

    it('keeps it on screen when the hub cannot be reached', async () => {
        saveTranscript(7, 's1', kept)
        const endpoints = fakeEndpoints(null)
        endpoints.messages = jest.fn(async () => Promise.reject(new Error('offline')))

        const { result } = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))
        await act(async () => {})

        expect(result.current.history).toBe('ready')
        expect(result.current.fresh).toBe(false)
    })

    it('keeps a stream started while the hub was being read, and reads again once it ends', async () => {
        saveTranscript(7, 's1', kept)
        const endpoints = fakeEndpoints('run-1')
        let answer: (messages: typeof kept) => void = () => {}
        endpoints.messages = jest.fn(() => new Promise<typeof kept>(resolve => (answer = resolve)))

        const { result } = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))
        await act(async () => mockChat.setStatus('streaming'))
        await act(async () => answer(kept))

        expect(mockChat.setMessages).not.toHaveBeenCalled()
        expect(mockChat.resumeStream).not.toHaveBeenCalled()
        expect(result.current.fresh).toBe(true)

        await act(async () => mockChat.setStatus('ready'))
        await act(async () => answer(kept))

        expect(endpoints.messages).toHaveBeenCalledTimes(2)
    })

    it('shows the loading state for a conversation never opened on this phone', async () => {
        const endpoints = fakeEndpoints(null)
        endpoints.messages = jest.fn(() => new Promise<never>(() => {}))

        const { result } = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's2' }))

        expect(mockChat.initialMessages).toBeUndefined()
        expect(result.current.history).toBe('loading')
        expect(result.current.fresh).toBe(false)
    })
})

describe('useCoworkerChat opening a conversation', () => {
    const stored = [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hello' }] }]

    beforeEach(() => {
        clearLocalCache()
        mockChat.initialStatus = 'ready'
        jest.clearAllMocks()
    })

    it('asks for the running run without waiting for the transcript, and resumes only once the transcript is set', async () => {
        const endpoints = fakeEndpoints('run-2')
        let transcriptArrives: (messages: typeof stored) => void = () => {}
        endpoints.messages = jest.fn(() => new Promise<typeof stored>(resolve => (transcriptArrives = resolve)))
        await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))

        expect(endpoints.activeRun).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).not.toHaveBeenCalled()

        await act(async () => transcriptArrives(stored))

        expect(mockChat.setMessages).toHaveBeenCalledWith(stored)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(mockChat.setMessages.mock.invocationCallOrder[0]).toBeLessThan(mockChat.resumeStream.mock.invocationCallOrder[0]!)
    })

    it('still shows the transcript when the run lookup fails', async () => {
        const endpoints = fakeEndpoints(null)
        endpoints.messages = jest.fn(async () => stored)
        endpoints.activeRun = jest.fn(async () => {
            throw new Error('offline')
        })
        const { result } = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))
        await act(async () => {})

        expect(result.current.history).toBe('ready')
        expect(mockChat.setMessages).toHaveBeenCalledWith(stored)
        expect(mockChat.resumeStream).not.toHaveBeenCalled()
    })
})

async function followRun(endpoints: ChatEndpoints) {
    mockChat.initialStatus = 'ready'
    mockChat.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'working' }] },
    ]
    const rendered = await renderHook(() => useCoworkerChat({ endpoints, initialSessionId: 's1' }))
    await act(async () => {})
    await act(async () => mockChat.reconnected())
    await act(async () => mockChat.setStatus('streaming'))
    jest.clearAllMocks()
    return rendered
}

describe('useCoworkerChat back to a run it followed', () => {
    beforeEach(() => {
        clearLocalCache()
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListener = listener as (state: AppStateStatus) => void
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })
    afterEach(() => {
        mockChat.messages = []
    })

    it('picks the stream up at once on return, before any read, onto the message left on screen', async () => {
        const endpoints = fakeEndpoints('run-1')
        const { result } = await followRun(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(endpoints.messages).not.toHaveBeenCalled()
        expect(mockChat.resumeOntoRef.current).toBe('a1')
        expect(result.current.busy).toBe(true)
    })

    it('reads the transcript once the replay ends', async () => {
        const endpoints = fakeEndpoints('run-1')
        const { result } = await followRun(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))
        await act(async () => mockChat.streamEnded())

        expect(endpoints.messages).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(result.current.busy).toBe(false)
    })

    it('picks up a newer run holding the conversation once the replay ends', async () => {
        const endpoints = fakeEndpoints('run-1')
        await followRun(endpoints)
        endpoints.activeRun = jest.fn(async () => 'run-9')

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))
        await act(async () => mockChat.streamEnded())

        expect(endpoints.messages).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(2)
    })

    it('picks up a newer run even when the replay ends before the lookup answers', async () => {
        const endpoints = fakeEndpoints('run-1')
        const { result } = await followRun(endpoints)
        let answerLookup = (_running: string | null) => {}
        endpoints.activeRun = jest.fn(() => new Promise<string | null>(resolve => (answerLookup = resolve)))

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))
        await act(async () => mockChat.streamEnded())

        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(endpoints.messages).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(true)

        endpoints.activeRun = jest.fn(async () => 'run-9')
        await act(async () => answerLookup('run-9'))

        expect(endpoints.messages).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(2)
    })

    it('falls back to the transcript when the reconnect cannot reach the hub on return', async () => {
        const endpoints = fakeEndpoints('run-1')
        const { result } = await followRun(endpoints)
        mockChat.resumeStream.mockImplementationOnce(async () => {
            mockChat.reconnectFailedRef.current = true
            mockChat.setStatus('error')
        })

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(mockChat.clearError).toHaveBeenCalledTimes(1)
        expect(endpoints.messages).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(2)
        expect(result.current.error).toBeUndefined()
    })
})

describe('useCoworkerChat in the time iOS grants in the background', () => {
    beforeEach(() => {
        clearLocalCache()
        jest.useFakeTimers()
        mockGrace.module = { begin: jest.fn(async () => 30), end: jest.fn(async () => true) }
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListener = listener as (state: AppStateStatus) => void
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })
    afterEach(() => {
        jest.useRealTimers()
        mockGrace.module = null
        mockChat.messages = []
    })

    it('keeps the stream open', async () => {
        const { result } = await followRun(fakeEndpoints('run-1'))

        await act(async () => appStateListener('background'))

        expect(mockGrace.module!.begin).toHaveBeenCalledTimes(1)
        expect(mockChat.stop).not.toHaveBeenCalled()
        expect(result.current.busy).toBe(true)
    })

    it('comes back to a stream that never stopped, with nothing to load', async () => {
        const endpoints = fakeEndpoints('run-1')
        await followRun(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(mockGrace.module!.end).toHaveBeenCalledTimes(1)
        expect(mockChat.stop).not.toHaveBeenCalled()
        expect(mockChat.resumeStream).not.toHaveBeenCalled()
        expect(endpoints.messages).not.toHaveBeenCalled()
    })

    it('lets the stream go a little before that time runs out, without stopping the run', async () => {
        const endpoints = fakeEndpoints('run-1')
        const { result } = await followRun(endpoints)

        await act(async () => appStateListener('background'))
        await act(async () => jest.advanceTimersByTime(25_000))

        expect(mockChat.stop).toHaveBeenCalledTimes(1)
        expect(endpoints.stop).not.toHaveBeenCalled()
        expect(mockGrace.module!.end).toHaveBeenCalledTimes(1)
        expect(result.current.busy).toBe(true)
    })

    it('picks the run up on return when iOS took the time back first', async () => {
        const endpoints = fakeEndpoints('run-1')
        await followRun(endpoints)
        mockGrace.module!.end = jest.fn(async () => false)

        await act(async () => appStateListener('background'))
        await act(async () => appStateListener('active'))

        expect(mockChat.stop).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeStream).toHaveBeenCalledTimes(1)
        expect(mockChat.resumeOntoRef.current).toBe('a1')
    })

    it('lets go at once when iOS grants too little time', async () => {
        await followRun(fakeEndpoints('run-1'))
        mockGrace.module!.begin = jest.fn(async () => 3)

        await act(async () => appStateListener('background'))

        expect(mockChat.stop).toHaveBeenCalledTimes(1)
    })
})
