import { mobileApi, type VaultItemSummary } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessDeniedError } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase } from '@/test/supabase-fake'

// The Vault of a coworker's Box, as the app's added-app card and Apps screen read it and lend from it.
const vault = vi.hoisted(() => ({ coworkerVault: vi.fn(), attachVaultEntry: vi.fn() }))
const state = vi.hoisted(() => ({ ctx: null as WorkspaceContext | null }))

vi.mock('@/app/api/_services/vault.service', () => vault)
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
}))

const AGENT_ID = '5b0f8f7e-3c1d-4b8a-9f62-0d7c1e4a2b91'
const GMAIL = 'vlt_01JD8Q2W4X'

const item = (over: Partial<VaultItemSummary>) => ({ id: GMAIL, kind: 'service', slug: 'gmail', name: 'Gmail', status: 'active', ...over }) as VaultItemSummary

beforeEach(() => {
    vi.clearAllMocks()
    state.ctx = contractContext(fakeSupabase(), { role: 'member' })
})

describe("a coworker's Vault accounts", () => {
    it('lists the accounts it could be lent', async () => {
        vault.coworkerVault.mockResolvedValue({ attached: [], canAttach: true, available: [item({ label: 'sales@atelier-nord.fr' })] })
        const { GET } = await import('@/app/api/v1/agents/[id]/vault/route')

        const accounts = await expectContract(mobileApi.listVaultAccounts, await callRoute(GET, mobileApi.listVaultAccounts, { params: { id: AGENT_ID } }))

        expect(accounts).toEqual({ canAttach: true, accounts: [{ id: GMAIL, slug: 'gmail', label: 'sales@atelier-nord.fr' }] })
    })

    it('lends one to the coworker', async () => {
        vault.attachVaultEntry.mockResolvedValue(item({}))
        const { POST } = await import('@/app/api/v1/agents/[id]/vault/route')

        expect(await expectContract(mobileApi.lendVaultAccount, await callRoute(POST, mobileApi.lendVaultAccount, { params: { id: AGENT_ID }, body: { itemId: GMAIL } }))).toBeUndefined()
        expect(vault.attachVaultEntry).toHaveBeenCalledWith(GMAIL, AGENT_ID, expect.objectContaining({ userId: 'user-ada', workspaceId: 7 }))
    })

    it("refuses a member who does not manage the coworker's Box", async () => {
        vault.attachVaultEntry.mockRejectedValue(new AccessDeniedError())
        const { POST } = await import('@/app/api/v1/agents/[id]/vault/route')

        await expectContract(mobileApi.lendVaultAccount, await callRoute(POST, mobileApi.lendVaultAccount, { params: { id: AGENT_ID }, body: { itemId: GMAIL } }), 403)
    })
})
