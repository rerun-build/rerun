import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimSignIn = vi.fn()
const putMcpToken = vi.fn()
const markServiceAuthorized = vi.fn()
const markManagedAuthorized = vi.fn()
const markComposioAuthorized = vi.fn()
vi.mock('@/lib/oauth/pending-grant', () => ({ claimSignIn: (...args: unknown[]) => claimSignIn(...args), SignInClaimError: class SignInClaimError extends Error {} }))
vi.mock('@/lib/engine/client', () => ({ putMcpToken: (...args: unknown[]) => putMcpToken(...args), supportsVault: async () => false }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: async () => ({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-agent' }) }))
vi.mock('@/app/api/_services/services.service', () => ({
    markServiceAuthorized: (...args: unknown[]) => markServiceAuthorized(...args),
    markManagedAuthorized: (...args: unknown[]) => markManagedAuthorized(...args),
    markComposioAuthorized: (...args: unknown[]) => markComposioAuthorized(...args),
}))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: () => ({ id: 'acme', oauth: { tokenEndpoint: 'https://acme.test/token', clientIdEnv: 'ACME_CLIENT_ID', clientSecretEnv: 'ACME_CLIENT_SECRET' } }) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', userEmail: null, authUser: { id: 'user-1' }, workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }),
}))

const { POST } = await import('./route')

const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' }

const call = (body: object) => POST(new Request('https://app.rerun.build/api/v1/agents/agent-1/services/acme/authorized', { method: 'POST', body: JSON.stringify(body), headers: { 'x-workspace-id': '7' } }), { params: Promise.resolve({ id: 'agent-1', slug: 'acme' }) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ACME_CLIENT_ID', 'client-1')
    vi.stubEnv('ACME_CLIENT_SECRET', 'secret-1')
})

describe('POST /api/v1/agents/[id]/services/[slug]/authorized', () => {
    it('claims the row for the member who started the sign-in, then writes the token and flips the entry', async () => {
        claimSignIn.mockResolvedValue({ kind: 'managed', key: 'acme', provider: 'acme', serverName: 'acme', token: { accessToken: 'at', refreshToken: 'rt' }, email: 'me@acme.test' })

        const res = await call({ claim: 'row-1' })

        expect(res.status).toBe(204)
        expect(claimSignIn).toHaveBeenCalledWith('row-1', { agentId: 'agent-1', workspaceId: 7, userId: 'user-1' })
        expect(putMcpToken).toHaveBeenCalledWith({ baseUrl: 'https://engine.test', apiKey: null }, 'engine-agent', 'acme', expect.objectContaining({ accessToken: 'at', refreshToken: 'rt', tokenEndpoint: 'https://acme.test/token', clientId: 'client-1', clientSecret: 'secret-1' }))
        expect(markManagedAuthorized).toHaveBeenCalledWith('agent-1', 'acme', 'me@acme.test', ACTOR)
    })

    it('flips a catalog entry reached through a plain MCP sign-in once its token is on the Box', async () => {
        claimSignIn.mockResolvedValue({ kind: 'mcp', serverName: 'acme', token: { accessToken: 'at' } })

        expect((await call({ claim: 'row-1' })).status).toBe(204)
        expect(putMcpToken).toHaveBeenCalledWith(expect.anything(), 'engine-agent', 'acme', { accessToken: 'at' })
        expect(markServiceAuthorized).toHaveBeenCalledWith('agent-1', 'acme', ACTOR)
    })

    it('refuses a claim parked for another app, and writes nothing', async () => {
        claimSignIn.mockResolvedValue({ kind: 'composio', key: 'gmail', connectedAccountId: 'ca_1' })

        expect((await call({ claim: 'row-1' })).status).toBe(409)
        expect(markComposioAuthorized).not.toHaveBeenCalled()
    })

    it('answers 409 when the row is gone, spent or someone else\'s', async () => {
        const { SignInClaimError } = await import('@/lib/oauth/pending-grant')
        claimSignIn.mockRejectedValue(new SignInClaimError('Sign-in expired, please retry'))

        const res = await call({ claim: 'row-1' })

        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({ error: 'Sign-in expired, please retry' })
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('no longer flips an entry on a bare call without a claim', async () => {
        expect((await call({})).status).toBe(400)
        expect(markServiceAuthorized).not.toHaveBeenCalled()
    })
})
