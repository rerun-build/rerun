import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthorizationError } from '@/app/api/_auth/ownership'

const assertAgentInWorkspace = vi.fn()
const getMcpSessionStates = vi.fn()
const reconnectMcpSession = vi.fn()

vi.mock('@/app/api/_auth/access', () => ({ assertAgentInWorkspace: (id: string) => assertAgentInWorkspace(id) }))
vi.mock('@/app/api/_services/custom-mcp.service', () => ({
    getMcpSessionStates: (id: string) => getMcpSessionStates(id),
    reconnectMcpSession: (id: string, name: string) => reconnectMcpSession(id, name),
}))

import { GET, POST } from './route'

const ctx = { params: Promise.resolve({ id: 'a1' }) }
const post = (body: unknown) => new Request('http://x/api/agents/a1/mcp-session', { method: 'POST', body: JSON.stringify(body) })

describe('mcp-session route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        assertAgentInWorkspace.mockResolvedValue(undefined)
    })

    it('GET answers the servers with their state', async () => {
        const servers = [{ name: 'notion', state: 'failed', errorClass: 'auth' }]
        getMcpSessionStates.mockResolvedValue(servers)
        const res = await GET(new Request('http://x'), ctx)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ servers })
        expect(getMcpSessionStates).toHaveBeenCalledWith('a1')
    })

    it('POST reconnects the named server and answers the result', async () => {
        const result = { name: 'notion', reconnected: true, effect: 'next_call', announced: 1 }
        reconnectMcpSession.mockResolvedValue(result)
        const res = await POST(post({ name: 'notion' }), ctx)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(result)
        expect(reconnectMcpSession).toHaveBeenCalledWith('a1', 'notion')
    })

    it('POST without a name answers 400 and reconnects nothing', async () => {
        const res = await POST(post({ name: 5 }), ctx)
        expect(res.status).toBe(400)
        expect(reconnectMcpSession).not.toHaveBeenCalled()
        const empty = await POST(new Request('http://x', { method: 'POST', body: 'nope' }), ctx)
        expect(empty.status).toBe(400)
    })

    it('answers 404 for an agent of another workspace', async () => {
        assertAgentInWorkspace.mockRejectedValue(new AuthorizationError('coworkerNotFound'))
        expect((await GET(new Request('http://x'), ctx)).status).toBe(404)
        expect((await POST(post({ name: 'n' }), ctx)).status).toBe(404)
        expect(reconnectMcpSession).not.toHaveBeenCalled()
    })

    it('answers 401 when not signed in', async () => {
        assertAgentInWorkspace.mockRejectedValue(new Error('no session'))
        expect((await GET(new Request('http://x'), ctx)).status).toBe(401)
        expect((await POST(post({ name: 'n' }), ctx)).status).toBe(401)
    })

    it('answers 502 when the engine is unreachable', async () => {
        getMcpSessionStates.mockRejectedValue(new Error('Engine unreachable'))
        reconnectMcpSession.mockRejectedValue(new Error('Engine unreachable'))
        expect((await GET(new Request('http://x'), ctx)).status).toBe(502)
        expect((await POST(post({ name: 'n' }), ctx)).status).toBe(502)
    })
})
