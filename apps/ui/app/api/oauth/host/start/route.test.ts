import { decodeContext } from '@/lib/mcp-oauth'
import type { HostReturn } from '@/lib/oauth/host-sign-in'
import { afterEach, describe, expect, it, vi } from 'vitest'

const WPCOM_MCP = 'https://public-api.wordpress.com/wpcom/v2/mcp/v1'

const back: HostReturn = {
    agentId: '',
    workspaceId: 7,
    userId: 'user-1',
    organizationId: 'org-1',
    origin: 'https://agency.example',
    nonceId: 'nonce-1',
    nonceHash: 'hash',
    target: { flow: 'mcp', serverName: 'wordpress', mcpUrl: WPCOM_MCP, vaultItem: 'item-1' },
}

vi.mock('@/lib/brand/request-site', () => ({ isRerunHost: async () => true }))
vi.mock('@/lib/oauth/host-sign-in', () => ({
    openHostTicket: async () => back,
    returnToHost: (_back: HostReturn, result: unknown) => Response.json(result, { status: 400 }),
}))
vi.mock('@/lib/mcp-oauth', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/mcp-oauth')>()),
    discoverAuthServer: async () => ({
        authorizationEndpoint: 'https://public-api.wordpress.com/oauth2-1/authorize',
        tokenEndpoint: 'https://public-api.wordpress.com/oauth2-1/token',
        registrationEndpoint: 'https://public-api.wordpress.com/oauth2-1/register',
        scopesSupported: ['global', 'auth', 'openid', 'posts', 'media'],
        resource: WPCOM_MCP,
    }),
}))

const { GET } = await import('./route')

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/oauth/host/start, for a sign-in started on an organization address', () => {
    it("signs WordPress.com in through Rerun's own app on the OAuth 2 endpoints, the secret kept on the hub", async () => {
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_ID', 'wpcom-app')
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_SECRET', 'wpcom-secret')
        vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-ticket-secret-of-at-least-32-chars')

        const res = await GET(new Request('https://rerun.test/api/oauth/host/start?t=ticket'))

        expect(res.status).toBe(302)
        const authorize = new URL(res.headers.get('location')!)
        expect(authorize.origin + authorize.pathname).toBe('https://public-api.wordpress.com/oauth2/authorize')
        expect(authorize.searchParams.get('client_id')).toBe('wpcom-app')
        expect(authorize.searchParams.get('scope')).toBe('global')
        const ctx = decodeContext(res.cookies.getAll()[0].value)
        expect(ctx).toMatchObject({ clientId: 'wpcom-app', tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token', mcpUrl: WPCOM_MCP, resource: WPCOM_MCP })
        expect(ctx.clientSecret).toBeUndefined()
    })
})
