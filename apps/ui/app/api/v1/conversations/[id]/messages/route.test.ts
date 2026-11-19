import { beforeEach, describe, expect, it, vi } from 'vitest'

const readSessionTranscript = vi.fn()
vi.mock('@/app/api/_services/conversation.service', () => ({ readSessionTranscript: (...args: unknown[]) => readSessionTranscript(...args) }))
vi.mock('@/lib/chat/engine-history', () => ({ toApiMessages: (messages: unknown) => messages }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }),
}))

const { GET } = await import('./route')

const segment = { params: Promise.resolve({ id: 'session-1' }) }
const read = (etag?: string) => GET(new Request('https://app.rerun.build/api/v1/conversations/session-1/messages', { headers: etag ? { 'If-None-Match': etag } : {} }), segment)
const transcript = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]

describe('GET /api/v1/conversations/:id/messages', () => {
    beforeEach(() => {
        readSessionTranscript.mockReset().mockResolvedValue({ messages: transcript, updatedAt: '2026-11-19T08:00:00Z' })
    })

    it('names the transcript it sends and the version of the conversation it was read at', async () => {
        const res = await read()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(transcript)
        expect(res.headers.get('etag')).toMatch(/^"[\w-]+"$/)
        expect(res.headers.get('x-conversation-updated-at')).toBe('2026-11-19T08:00:00Z')
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    // The app already holds it: the body stays on the hub.
    it('answers 304 without a body to the ETag of the same transcript', async () => {
        const etag = (await read()).headers.get('etag')!
        const res = await read(etag)
        expect(res.status).toBe(304)
        expect(await res.text()).toBe('')
        expect(res.headers.get('etag')).toBe(etag)
        expect(res.headers.get('x-conversation-updated-at')).toBe('2026-11-19T08:00:00Z')
    })

    it('reads a weak ETag, as a compressing proxy hands it on, as the same transcript', async () => {
        const etag = (await read()).headers.get('etag')!
        expect((await read(`W/${etag}`)).status).toBe(304)
    })

    it('sends the whole transcript again once it changed', async () => {
        const etag = (await read()).headers.get('etag')!
        readSessionTranscript.mockResolvedValue({ messages: [...transcript, { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }], updatedAt: '2026-11-19T08:01:00Z' })
        const res = await read(etag)
        expect(res.status).toBe(200)
        expect(await res.json()).toHaveLength(2)
        expect(res.headers.get('etag')).not.toBe(etag)
    })
})
