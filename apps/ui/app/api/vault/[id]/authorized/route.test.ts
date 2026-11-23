import { AccessDeniedError } from '@/app/api/_auth/access'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { getVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimSignIn = vi.fn()
vi.mock('@/lib/oauth/pending-grant', () => ({ claimSignIn: (...args: unknown[]) => claimSignIn(...args), SIGN_IN_EXPIRED: 'Sign-in expired, please retry', SignInClaimError: class SignInClaimError extends Error {} }))
vi.mock('@/app/api/_services/vault.service', () => ({ vaultContext: vi.fn(), assertCanAdd: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn(), putVaultToken: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn() }))
vi.mock('@/app/api/_services/services.service', () => ({ markServiceAuthorized: vi.fn(), markManagedAuthorized: vi.fn(), markComposioAuthorized: vi.fn() }))

const { POST } = await import('./route')

const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'admin', boxScope: 'all' } as const
const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const NOTION = { serverName: 'notion', url: 'https://mcp.notion.com/mcp' }
const PARKED = { kind: 'mcp', serverName: 'notion', mcpUrl: NOTION.url, token: { accessToken: 'at', refreshToken: 'rt', tokenEndpoint: 'https://mcp.notion.com/token', clientId: 'dcr-client' } }

const call = (body: object) => POST(new Request('https://app.rerun.build/api/vault/item-1/authorized', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'item-1' }) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vaultContext).mockResolvedValue({ actor: ACTOR, conn: CONN, coworkers: [], byEngineId: new Map() })
    vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1', oauth: NOTION } as never)
    claimSignIn.mockResolvedValue(PARKED)
})

describe('POST /api/vault/[id]/authorized', () => {
    it('claims the row for the member who started the sign-in and writes the token on the entry', async () => {
        const res = await call({ claim: 'row-1' })

        expect(res.status).toBe(204)
        expect(claimSignIn).toHaveBeenCalledWith('row-1', { agentId: '', workspaceId: 7, userId: 'user-1' })
        expect(putVaultToken).toHaveBeenCalledWith(CONN, 'item-1', 'notion', expect.objectContaining({ accessToken: 'at', refreshToken: 'rt', clientId: 'dcr-client' }))
    })

    it('refuses a sign-in parked for another server, and writes nothing', async () => {
        for (const parked of [{ ...PARKED, serverName: 'notion-2' }, { ...PARKED, mcpUrl: 'https://mcp.linear.app/mcp' }, { kind: 'composio', key: 'gmail', connectedAccountId: 'ca_1' }]) {
            claimSignIn.mockResolvedValueOnce(parked)
            const res = await call({ claim: 'row-1' })
            expect(res.status).toBe(409)
            expect(await res.json()).toMatchObject({ code: 'signInForAnotherServer' })
        }
        expect(putVaultToken).not.toHaveBeenCalled()
    })

    it("answers 409 when the row is gone, spent or someone else's", async () => {
        const { SignInClaimError } = await import('@/lib/oauth/pending-grant')
        claimSignIn.mockRejectedValue(new SignInClaimError('Sign-in expired, please retry'))

        const res = await call({ claim: 'row-1' })

        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({ code: 'signInExpired' })
        expect(putVaultToken).not.toHaveBeenCalled()
    })

    it('refuses a member who may not add to the Vault, before the row is spent', async () => {
        vi.mocked(assertCanAdd).mockRejectedValue(new AccessDeniedError('vaultManageOnly'))

        expect((await call({ claim: 'row-1' })).status).toBe(403)
        expect(claimSignIn).not.toHaveBeenCalled()
    })

    it('refuses a call without a claim', async () => {
        expect((await call({})).status).toBe(400)
        expect(claimSignIn).not.toHaveBeenCalled()
    })
})
