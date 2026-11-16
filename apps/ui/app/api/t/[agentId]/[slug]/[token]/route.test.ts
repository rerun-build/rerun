import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAgentTargetForTrigger } from '@/app/api/_services/chat.service'
import { fireTrigger } from '@/lib/engine/client'
import { MAX_TRIGGER_BODY_BYTES } from '@/lib/triggers/webhook'
import { GET, HEAD, OPTIONS, POST } from './route'

vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTargetForTrigger: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ fireTrigger: vi.fn() }))

const target = { engineAgentId: 'engine-agent', conn: { baseUrl: 'https://engine.test', apiKey: 'box-key' } }

function context(params: Partial<{ agentId: string; slug: string; token: string }> = {}) {
    return { params: Promise.resolve({ agentId: 'agent-1', slug: 'new-lead', token: 'secret-token', ...params }) }
}

function request(init: RequestInit = {}, search = '') {
    return new Request(`https://rerun.test/api/t/agent-1/new-lead/secret-token${search}`, { method: 'POST', ...init })
}

describe('/api/t/[agentId]/[slug]/[token]', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(resolveAgentTargetForTrigger).mockResolvedValue(target)
        vi.mocked(fireTrigger).mockResolvedValue({ status: 202, runId: 'run-1', sessionId: 'session-1' })
    })

    it('forwards the caller request to the engine and answers with the run id', async () => {
        const response = await POST(request({ body: '{"email":"a@b.c"}', headers: { 'content-type': 'application/json' } }, '?source=form'), context())

        expect(response.status).toBe(202)
        expect(await response.json()).toEqual({ runId: 'run-1', sessionId: 'session-1', trigger: 'new-lead' })
        expect(fireTrigger).toHaveBeenCalledWith(
            target.conn,
            'engine-agent',
            'new-lead',
            { token: 'secret-token', method: 'POST', query: 'source=form', contentType: 'application/json', body: '{"email":"a@b.c"}', bodyBytes: 17 },
            expect.any(AbortSignal),
        )
    })

    it.each(['Bad_Slug', '-leading-dash', 'a'.repeat(65), 'has/slash'])('answers 404 for the malformed slug %s without resolving the agent', async slug => {
        const response = await POST(request(), context({ slug }))

        expect(response.status).toBe(404)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('answers 404 when the token segment is empty', async () => {
        const response = await POST(request(), context({ token: '' }))

        expect(response.status).toBe(404)
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it.each([
        ['a Slack unfurl', { 'user-agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' }],
        ['a browser prefetch', { 'sec-purpose': 'prefetch' }],
        ['a page navigation', { 'sec-fetch-dest': 'document' }],
    ])('answers 204 to %s and fires nothing', async (_label, headers) => {
        const response = await GET(request({ method: 'GET', headers }), context())

        expect(response.status).toBe(204)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('refuses a body over the size limit with 413 before resolving the agent', async () => {
        const response = await POST(request({ body: 'x'.repeat(MAX_TRIGGER_BODY_BYTES + 1) }), context())

        expect(response.status).toBe(413)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('measures the size limit in bytes, not characters', async () => {
        const response = await POST(request({ body: 'é'.repeat(MAX_TRIGGER_BODY_BYTES / 2 + 1) }), context())

        expect(response.status).toBe(413)
    })

    it('accepts a body exactly at the size limit', async () => {
        const response = await POST(request({ body: 'x'.repeat(MAX_TRIGGER_BODY_BYTES) }), context())

        expect(response.status).toBe(202)
    })

    it('refuses a declared Content-Length over the size limit before reading the body', async () => {
        const req = request({ body: 'small', headers: { 'content-length': String(MAX_TRIGGER_BODY_BYTES + 1) } })

        const response = await POST(req, context())

        expect(response.status).toBe(413)
        expect(req.bodyUsed).toBe(false)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
    })

    it('refuses a streamed body that outgrows its declared Content-Length', async () => {
        const chunk = new Uint8Array(64 * 1024)
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent >= 4 * MAX_TRIGGER_BODY_BYTES) return controller.close()
                sent += chunk.byteLength
                controller.enqueue(chunk)
            },
        })
        const req = request({ body, headers: { 'content-length': '10' }, duplex: 'half' } as RequestInit)

        const response = await POST(req, context())

        expect(response.status).toBe(413)
        expect(sent).toBeLessThanOrEqual(MAX_TRIGGER_BODY_BYTES + 2 * chunk.byteLength)
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('answers 404 for an agent that cannot be resolved', async () => {
        vi.mocked(resolveAgentTargetForTrigger).mockResolvedValue(null)

        const response = await POST(request(), context())

        expect(response.status).toBe(404)
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('relays the methods the trigger accepts in the Allow header when the engine answers 405', async () => {
        vi.mocked(fireTrigger).mockResolvedValue({ status: 405, allow: ['POST', 'PUT'] })

        const response = await GET(request({ method: 'GET' }), context())

        expect(response.status).toBe(405)
        expect(response.headers.get('Allow')).toBe('POST, PUT')
    })

    it('answers 405 without an Allow header when the engine names no method', async () => {
        vi.mocked(fireTrigger).mockResolvedValue({ status: 405 })

        const response = await GET(request({ method: 'GET' }), context())

        expect(response.status).toBe(405)
        expect(response.headers.get('Allow')).toBeNull()
    })

    it.each([401, 403, 404, 500])('hides an engine %i behind an opaque 404', async status => {
        vi.mocked(fireTrigger).mockResolvedValue({ status })

        const response = await POST(request(), context())

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Not found' })
    })

    it('answers 404 when the engine accepts the call without a run id', async () => {
        vi.mocked(fireTrigger).mockResolvedValue({ status: 202 })

        const response = await POST(request(), context())

        expect(response.status).toBe(404)
    })

    it('hides an engine failure behind an opaque 404', async () => {
        vi.mocked(fireTrigger).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.4:3000'))

        const response = await POST(request(), context())

        expect(response.status).toBe(404)
        expect(await response.text()).not.toContain('ECONNREFUSED')
    })

    it('never fires the trigger on HEAD', () => {
        const response = HEAD()

        expect(response.status).toBe(200)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
        expect(fireTrigger).not.toHaveBeenCalled()
    })

    it('never fires the trigger on OPTIONS', () => {
        const response = OPTIONS()

        expect(response.status).toBe(204)
        expect(resolveAgentTargetForTrigger).not.toHaveBeenCalled()
        expect(fireTrigger).not.toHaveBeenCalled()
    })
})
