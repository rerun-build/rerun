import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { dispatchForemanVaultTool, vaultAccountsToLend } from '@/lib/foreman/vault-tools'
import { dispatchForemanHubTool } from './foreman-hub.service'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: vi.fn(async () => 'founder') }))
vi.mock('@/app/api/_services/mcp-account.service', () => ({ dispatchAccountTool: vi.fn(async () => ({ declared: true })) }))
vi.mock('@/lib/foreman/box-tools', () => ({ dispatchBoxTool: vi.fn() }))
vi.mock('@/lib/foreman/onboarding-tools', () => ({ dispatchWorkspaceOnboardingTool: vi.fn() }))
vi.mock('@/lib/foreman/search-docs', () => ({ searchDocs: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/foreman/vault-tools', () => ({
    FOREMAN_VAULT_TOOL_NAMES: new Set(['list_vault', 'set_vault_link']),
    dispatchForemanVaultTool: vi.fn(async () => ({ available: true })),
    vaultAccountsToLend: vi.fn(async () => null),
}))

const member: Actor = { kind: 'user', userId: 'member-1', workspaceId: 7, role: 'member', boxScope: 'all' }

describe('dispatchForemanHubTool', () => {
    beforeEach(() => vi.clearAllMocks())

    it('runs the Vault tools as the member the turn speaks for', async () => {
        await dispatchForemanHubTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: true })
        expect(dispatchForemanVaultTool).toHaveBeenCalledWith(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: true })
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('answers with the accounts of the Vault instead of declaring the app a second time', async () => {
        vi.mocked(vaultAccountsToLend).mockResolvedValueOnce({ declared: false } as never)
        expect(await dispatchForemanHubTool(member, 'attach_connector', { agentId: 'bob', slug: 'gmail' })).toEqual({ declared: false })
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('declares the app as before when the Vault has nothing to lend', async () => {
        await dispatchForemanHubTool(member, 'attach_connector', { agentId: 'bob', slug: 'gmail' })
        expect(dispatchAccountTool).toHaveBeenCalledWith(member, 'attach_connector', { agentId: 'bob', slug: 'gmail' }, { actorUserId: 'member-1' })
    })

    it('refuses a tool it was never handed', async () => {
        await expect(dispatchForemanHubTool(member, 'delete_vault_entry', {})).rejects.toThrow('Unknown foreman tool')
    })
})
