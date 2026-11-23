import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCustomMcpServer = vi.fn()
const assertAgentAccess = vi.fn()
vi.mock('@/app/api/_services/custom-mcp.service', () => ({ getCustomMcpServer: (...args: unknown[]) => getCustomMcpServer(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }),
}))
vi.mock('@/app/api/_auth/access', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/access')>()),
    assertAgentAccess: (...args: unknown[]) => assertAgentAccess(...args),
}))

const { AccessDeniedError } = await import('@/app/api/_auth/access')
const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' }

const server = await import('./route')
const connect = await import('./connect/route')

const segment = { params: Promise.resolve({ id: 'agent-1', name: 'linear' }) }
const request = (method: string) => new Request('https://app.rerun.build/api/v1/agents/agent-1/mcp/linear', { method })
const LINEAR = { name: 'linear', displayName: 'Linear', transport: 'http', host: 'mcp.linear.app', icon: 'https://cdn/linear.svg', signInUrl: 'https://mcp.linear.app/mcp' }

describe('/api/v1/agents/:id/mcp/:name', () => {
    beforeEach(() => {
        vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
        getCustomMcpServer.mockReset().mockResolvedValue({ server: LINEAR, status: 'needs_auth' })
        assertAgentAccess.mockReset().mockImplementation(async (_id: string, _need: string, actor: unknown) => ({ actor }))
    })

    it('describes the server without its url, in the caller’s workspace', async () => {
        expect(await (await server.GET(request('GET'), segment)).json()).toEqual({ name: 'linear', displayName: 'Linear', host: 'mcp.linear.app', icon: 'https://cdn/linear.svg', status: 'needs_auth', canSignIn: true })
        expect(getCustomMcpServer).toHaveBeenCalledWith('agent-1', 'linear', ACTOR)
    })

    it('answers 404 for a server the agent does not have', async () => {
        getCustomMcpServer.mockResolvedValue(null)
        expect((await server.GET(request('GET'), segment)).status).toBe(404)
        expect((await connect.POST(request('POST'), segment)).status).toBe(404)
    })

    it('opens the sign-in through a ticket, and ends it in the app', async () => {
        const body = await (await connect.POST(request('POST'), segment)).json()
        expect(body.returnUrl).toBe('rerun://oauth/callback')
        expect(body.url).toMatch(/\/api\/oauth\/mobile\/start\?t=/)
        expect(assertAgentAccess).toHaveBeenCalledWith('agent-1', 'manage', ACTOR)
    })

    it('mints no ticket for a member who only uses the Box', async () => {
        assertAgentAccess.mockRejectedValue(new AccessDeniedError())
        const res = await connect.POST(request('POST'), segment)
        expect(res.status).toBe(403)
        expect(getCustomMcpServer).not.toHaveBeenCalled()
    })

    it('refuses a server whose url cannot go through the browser', async () => {
        getCustomMcpServer.mockResolvedValue({ server: { ...LINEAR, signInUrl: null }, status: 'unknown' })
        expect((await connect.POST(request('POST'), segment)).status).toBe(409)
    })
})
