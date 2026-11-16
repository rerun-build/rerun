import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { listVault } from '@/app/api/_services/vault.service'
import { dispatchForemanVaultTool } from './vault-tools'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/vault.service', () => ({
    listVault: vi.fn(),
    VaultUnavailableError: class VaultUnavailableError extends Error {},
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ NoEngineError: class NoEngineError extends Error {} }))

const member: Actor = { kind: 'user', userId: 'member-1', workspaceId: 7, role: 'member', boxScope: 'all' }

const gmail = {
    id: 'item-1',
    kind: 'service',
    slug: 'gmail',
    name: 'Gmail',
    label: 'ada@acme.test',
    status: 'needs_auth',
    config: { region: 'eu' },
    mcpServers: [{ name: 'gmail', url: 'https://mcp.test' }],
    skills: [],
    composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_secret', userId: 'composio-user' },
    agentIds: ['e-alice', 'e-carol'],
    sharedWithAll: false,
    createdBy: 'admin-1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    envKeys: ['GMAIL_TOKEN'],
    tokens: ['gmail'],
    coworkers: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box-a' }],
    hiddenCoworkers: 1,
    canChange: false,
}

describe('list_vault', () => {
    beforeEach(() => vi.mocked(listVault).mockReset())

    it('reads the Vault as the member the turn speaks for', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [], coworkers: [], canAdd: true, isAdmin: false })
        await dispatchForemanVaultTool(member, 'list_vault', {})
        expect(listVault).toHaveBeenCalledWith(member)
    })

    it('names each account, its state and who holds it, and counts the coworkers the member cannot see', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [gmail] as never, coworkers: [], canAdd: true, isAdmin: false })
        const out = (await dispatchForemanVaultTool(member, 'list_vault', {})) as { available: boolean; entries: unknown[]; youAreAdmin: boolean }
        expect(out).toEqual({
            available: true,
            youAreAdmin: false,
            entries: [{ id: 'item-1', name: 'Gmail', kind: 'service', slug: 'gmail', account: 'ada@acme.test', status: 'needs_auth', sharedWithAll: false, coworkers: [{ id: 'alice', name: 'Alice' }], hiddenCoworkers: 1 }],
        })
    })

    it('never hands the model variable names, token servers, Composio ids, settings or who added the entry', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [gmail] as never, coworkers: [], canAdd: true, isAdmin: true })
        const text = JSON.stringify(await dispatchForemanVaultTool(member, 'list_vault', {}))
        for (const leak of ['GMAIL_TOKEN', 'ca_secret', 'composio-user', 'admin-1', 'e-alice', 'e-carol', 'mcp.test', 'region']) expect(text).not.toContain(leak)
    })

    it('marks a paid app, which cannot be shared with everyone', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [{ ...gmail, app: { appSlug: 'linkedin-pro', serverName: 'linkedin' }, hiddenCoworkers: 0 }] as never, coworkers: [], canAdd: true, isAdmin: true })
        const out = (await dispatchForemanVaultTool(member, 'list_vault', {})) as { entries: Array<Record<string, unknown>> }
        expect(out.entries[0].paid).toBe(true)
        expect(out.entries[0]).not.toHaveProperty('hiddenCoworkers')
    })

    it('says the box keeps no Vault rather than failing, on a box without one or without a machine', async () => {
        const { VaultUnavailableError } = await import('@/app/api/_services/vault.service')
        const { NoEngineError } = await import('@/app/api/_services/workspace-engine.service')
        for (const err of [new VaultUnavailableError(), new NoEngineError()]) {
            vi.mocked(listVault).mockRejectedValueOnce(err)
            expect(await dispatchForemanVaultTool(member, 'list_vault', {})).toMatchObject({ available: false })
        }
    })

    it('lets any other failure through', async () => {
        vi.mocked(listVault).mockRejectedValueOnce(new Error('engine down'))
        await expect(dispatchForemanVaultTool(member, 'list_vault', {})).rejects.toThrow('engine down')
    })
})
