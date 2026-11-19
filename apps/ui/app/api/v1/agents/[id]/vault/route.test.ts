import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VaultItemSummary } from '@rerun/contracts'

import { AccessDeniedError } from '@/app/api/_auth/access'

const coworkerVault = vi.fn()
const attachVaultEntry = vi.fn()
vi.mock('@/app/api/_services/vault.service', () => ({
    coworkerVault: (...args: unknown[]) => coworkerVault(...args),
    attachVaultEntry: (...args: unknown[]) => attachVaultEntry(...args),
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', userEmail: null, authUser: { id: 'user-1' }, workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }),
}))

const { GET, POST } = await import('./route')

const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' }
const URL = 'https://app.rerun.build/api/v1/agents/agent-1/vault'
const segment = { params: Promise.resolve({ id: 'agent-1' }) }

const item = (over: Partial<VaultItemSummary>) => ({ id: 'x', kind: 'service', slug: 'gmail', name: 'Gmail', status: 'active', ...over }) as VaultItemSummary

const list = () => GET(new Request(URL, { headers: { 'x-workspace-id': '7' } }), segment)
const attach = (body: object) => POST(new Request(URL, { method: 'POST', body: JSON.stringify(body), headers: { 'x-workspace-id': '7' } }), segment)

beforeEach(() => {
    vi.clearAllMocks()
})

describe('GET /api/v1/agents/[id]/vault', () => {
    it('lists the signed-in accounts of apps the coworker could be lent, by the name they were given first', async () => {
        coworkerVault.mockResolvedValue({
            attached: [],
            canAttach: true,
            available: [item({ id: 'a', label: 'sales@acme.test' }), item({ id: 'b', label: 'Gmail 2', customLabel: 'Personal' }), item({ id: 'c', slug: 'slack', name: 'Slack' }), item({ id: 'd' })],
        })

        const res = await list()

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            canAttach: true,
            accounts: [
                { id: 'a', slug: 'gmail', label: 'sales@acme.test' },
                { id: 'b', slug: 'gmail', label: 'Personal' },
                { id: 'c', slug: 'slack', label: 'Slack' },
                { id: 'd', slug: 'gmail', label: 'Gmail' },
            ],
        })
        expect(coworkerVault).toHaveBeenCalledWith('agent-1', ACTOR)
    })

    it('leaves out signed-out accounts, custom servers and secrets, and says when the caller cannot lend', async () => {
        coworkerVault.mockResolvedValue({ attached: [], canAttach: false, available: [item({ id: 'a', status: 'needs_auth' }), item({ id: 'b', kind: 'mcp', slug: null }), item({ id: 'c', kind: 'secret', slug: null })] })

        expect(await (await list()).json()).toEqual({ canAttach: false, accounts: [] })
    })

    it('offers nothing on a Box without a Vault', async () => {
        coworkerVault.mockResolvedValue(null)

        expect(await (await list()).json()).toEqual({ canAttach: false, accounts: [] })
    })
})

describe('POST /api/v1/agents/[id]/vault', () => {
    it('lends the account to the coworker as the calling member', async () => {
        attachVaultEntry.mockResolvedValue(item({ id: 'a' }))

        const res = await attach({ itemId: 'a' })

        expect(res.status).toBe(204)
        expect(attachVaultEntry).toHaveBeenCalledWith('a', 'agent-1', ACTOR)
    })

    it("answers 403 to a member who does not manage the coworker's Box", async () => {
        attachVaultEntry.mockRejectedValue(new AccessDeniedError())

        const res = await attach({ itemId: 'a' })

        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ code: 'boxManagerOnly' })
    })

    it('refuses an item id that is not one', async () => {
        expect((await attach({ itemId: '../etc' })).status).toBe(400)
        expect(attachVaultEntry).not.toHaveBeenCalled()
    })
})
