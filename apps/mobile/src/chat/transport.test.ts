import type { UIMessageChunk } from 'ai'
import { fetch as expoFetch } from 'expo/fetch'

import { createChatTransport, lastUserText, withStartMessageId, type ChatLink } from '@/chat/transport'

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }))

describe('lastUserText', () => {
    it('sends only the text of the message being sent, as the web does', () => {
        const messages = [
            { id: 'a', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Hi' }] },
            { id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'What is ' }, { type: 'text' as const, text: '6 times 7?' }] },
        ]
        expect(lastUserText(messages)).toBe('What is 6 times 7?')
    })

    it('sends nothing when the conversation does not end on the person', () => {
        expect(lastUserText([{ id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }])).toBe('')
    })
})

describe('withStartMessageId', () => {
    async function read(stream: ReadableStream<UIMessageChunk>) {
        const chunks: UIMessageChunk[] = []
        const reader = stream.getReader()
        for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value)
        return chunks
    }

    it('names the message on screen in the opening chunk only, so the replay takes its place', async () => {
        const replay = new ReadableStream<UIMessageChunk>({
            start(controller) {
                controller.enqueue({ type: 'start' })
                controller.enqueue({ type: 'text-start', id: 't1' })
                controller.enqueue({ type: 'start' })
                controller.close()
            },
        })

        expect(await read(withStartMessageId(replay, 'a1'))).toEqual([{ type: 'start', messageId: 'a1' }, { type: 'text-start', id: 't1' }, { type: 'start' }])
    })
})

describe('createChatTransport on a reconnect', () => {
    const fetchMock = expoFetch as unknown as jest.Mock

    function link(): ChatLink {
        return {
            endpoints: { agentId: 'ag', sendPath: '/api/chat', sendBody: () => ({}), bornSessionOf: () => null, messages: async () => ({ messages: [], etag: null, updatedAt: null }), activeRun: async () => null, stop: async () => {}, fileOwner: () => ({ kind: 'agent', agentId: 'ag' }) },
            sessionRef: { current: 's1' },
            runRef: { current: 'run-1' },
            callerRef: { current: null },
            onSessionRef: { current: () => {} },
            resumeOntoRef: { current: null },
            reconnectFailedRef: { current: false },
        }
    }

    it('marks a reconnect the hub could not be reached for', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
        const l = link()

        await expect(createChatTransport(l).reconnectToStream({ chatId: 'c' })).rejects.toThrow('Network request failed')

        expect(l.reconnectFailedRef.current).toBe(true)
    })

    it('leaves a reconnect stopped on the way alone', async () => {
        const controller = new AbortController()
        controller.abort()
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        const l = link()

        await expect(createChatTransport(l).reconnectToStream({ chatId: 'c', abortSignal: controller.signal })).rejects.toThrow('Aborted')

        expect(l.reconnectFailedRef.current).toBe(false)
    })
})
