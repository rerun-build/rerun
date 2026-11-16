import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendSessionMessage } from '@/lib/chat/send-session-message'

const ARGS = { agentId: 'agent-1', sessionId: 'session-1', text: 'Friendly', model: { connectionId: 'conn-1', model: 'sonnet' } }

function respondWith(response: Response | Error) {
    const fetchMock = vi.fn(async () => {
        if (response instanceof Error) throw response
        return response
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('sendSessionMessage', () => {
    it('posts the text to the chat route as a queued message and lets the stream go', async () => {
        const stream = new ReadableStream({ start: () => {} })
        const cancel = vi.spyOn(stream, 'cancel')
        const fetchMock = respondWith(new Response(stream, { status: 200 }))

        expect(await sendSessionMessage(ARGS)).toBe('sent')
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('/api/chat')
        expect(JSON.parse(init.body as string)).toEqual({ agentId: 'agent-1', sessionId: 'session-1', text: 'Friendly', connectionId: 'conn-1', model: 'sonnet', queued: true })
        expect(cancel).toHaveBeenCalled()
    })

    it('reads a conversation still running as busy', async () => {
        respondWith(Response.json({ error: 'run_in_flight' }, { status: 409 }))
        expect(await sendSessionMessage(ARGS)).toBe('busy')
    })

    it('fails on any other refusal and on a network error', async () => {
        respondWith(Response.json({ error: 'Engine error' }, { status: 502 }))
        expect(await sendSessionMessage(ARGS)).toBe('failed')
        respondWith(new Error('offline'))
        expect(await sendSessionMessage(ARGS)).toBe('failed')
    })
})
