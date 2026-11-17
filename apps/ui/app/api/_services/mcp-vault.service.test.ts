import type { VaultItemSummary } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    listVault: vi.fn(),
    attachVaultEntry: vi.fn(),
    detachVaultEntry: vi.fn(),
    shareVaultEntry: vi.fn(),
    vaultPaidAccounts: vi.fn(),
    attachVaultPaidAccount: vi.fn(),
    detachVaultPaidAccount: vi.fn(),
    dispatchShareTool: vi.fn(),
}))

class VaultUnavailableError extends Error {}
class NoEngineError extends Error {}

vi.mock('./vault.service', () => ({
    listVault: mocks.listVault,
    attachVaultEntry: mocks.attachVaultEntry,
    detachVaultEntry: mocks.detachVaultEntry,
    shareVaultEntry: mocks.shareVaultEntry,
    VaultUnavailableError,
}))
vi.mock('./vault-apps.service', () => ({
    vaultPaidAccounts: mocks.vaultPaidAccounts,
    attachVaultPaidAccount: mocks.attachVaultPaidAccount,
    detachVaultPaidAccount: mocks.detachVaultPaidAccount,
}))
vi.mock('./workspace-engine.service', () => ({ NoEngineError }))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: mocks.dispatchShareTool }))

const { dispatchVaultTool } = await import('./mcp-vault.service')

const ADMIN: Actor = { kind: 'user', userId: 'admin-1', workspaceId: 7, role: 'admin', boxScope: 'all' }
const SCOUT = { id: 'agent-scout', engineAgentId: 'engine-scout', name: 'Scout', spaceId: 'space-1' }
const CLOSER = { id: 'agent-closer', engineAgentId: 'engine-closer', name: 'Closer', spaceId: 'space-1' }

function item(overrides: Partial<VaultItemSummary> = {}): VaultItemSummary {
    return {
        id: 'item-gmail',
        kind: 'service',
        slug: 'gmail',
        name: 'Gmail',
        label: 'sales@acme.test',
        status: 'active',
        authMethodId: 'oauth',
        config: { region: 'eu' },
        mcpServers: [{ name: 'gmail', url: 'https://mcp.gmail.test' }],
        skills: [],
        oauth: { serverName: 'gmail', url: 'https://mcp.gmail.test' },
        composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_secret', userId: 'composio-user' },
        agentIds: ['engine-scout'],
        sharedWithAll: false,
        createdBy: 'admin-1',
        createdAt: '2026-11-10',
        updatedAt: '2026-11-10',
        envKeys: ['GMAIL_TOKEN'],
        tokens: ['gmail'],
        ...overrides,
    } as VaultItemSummary
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.listVault.mockResolvedValue({
        entries: [{ ...item(), coworkers: [SCOUT], hiddenCoworkers: 1, canChange: true }],
        coworkers: [
            { ...SCOUT, canManage: true },
            { ...CLOSER, canManage: false },
        ],
        canAdd: true,
        isAdmin: true,
    })
    mocks.vaultPaidAccounts.mockResolvedValue([
        { slug: 'linkedin', name: 'LinkedIn Pro', serviceSlug: 'linkedin-pro', connectionId: 'conn-1', label: 'Jane', status: 'connected', agentIds: ['agent-closer'], hiddenAgents: 0 },
    ])
})

describe('list_vault', () => {
    it('names each entry, its state and who holds it, and nothing it stores', async () => {
        const out = (await dispatchVaultTool(ADMIN, 'list_vault', {})) as Record<string, unknown>

        expect(mocks.listVault).toHaveBeenCalledWith(ADMIN)
        expect(out).toEqual({
            available: true,
            entries: [{ id: 'item-gmail', name: 'Gmail', kind: 'service', slug: 'gmail', account: 'sales@acme.test', status: 'active', sharedWithAll: false, coworkers: [{ id: 'agent-scout', name: 'Scout' }], hiddenCoworkers: 1, canChange: true }],
            paidAccounts: [{ id: 'conn-1', slug: 'linkedin', name: 'LinkedIn Pro', account: 'Jane', status: 'connected', coworkers: [{ id: 'agent-closer', name: 'Closer' }] }],
            coworkers: [
                { id: 'agent-scout', name: 'Scout', canManage: true },
                { id: 'agent-closer', name: 'Closer', canManage: false },
            ],
            canAdd: true,
            isAdmin: true,
        })
        const text = JSON.stringify(out)
        for (const stored of ['GMAIL_TOKEN', 'ca_secret', 'composio-user', 'mcp.gmail.test', 'region', 'engine-scout', 'admin-1']) expect(text).not.toContain(stored)
    })

    it('answers that there is no Vault on a machine without one, or without a machine', async () => {
        mocks.listVault.mockRejectedValueOnce(new VaultUnavailableError())
        await expect(dispatchVaultTool(ADMIN, 'list_vault', {})).resolves.toMatchObject({ available: false })

        mocks.listVault.mockRejectedValueOnce(new NoEngineError())
        await expect(dispatchVaultTool(ADMIN, 'list_vault', {})).resolves.toMatchObject({ available: false })
    })

    it('lets any other failure through', async () => {
        mocks.listVault.mockRejectedValueOnce(new Error('engine down'))
        await expect(dispatchVaultTool(ADMIN, 'list_vault', {})).rejects.toThrow('engine down')
    })
})

function shareGmailWithEveryone() {
    mocks.listVault.mockResolvedValue({ entries: [{ ...item({ sharedWithAll: true }), coworkers: [SCOUT], hiddenCoworkers: 0, canChange: true }], coworkers: [{ ...SCOUT, canManage: true }], canAdd: true, isAdmin: true })
}

describe('attach_vault_entry and detach_vault_entry', () => {
    it('lend a Vault entry through the Vault and answer with the entry as list_vault shows it', async () => {
        const out = await dispatchVaultTool(ADMIN, 'attach_vault_entry', { entryId: 'item-gmail', agentId: 'agent-closer' })

        expect(mocks.attachVaultEntry).toHaveBeenCalledWith('item-gmail', 'agent-closer', ADMIN)
        expect(mocks.attachVaultPaidAccount).not.toHaveBeenCalled()
        expect(out).toMatchObject({ id: 'item-gmail', name: 'Gmail', coworkers: [{ id: 'agent-scout', name: 'Scout' }] })

        await dispatchVaultTool(ADMIN, 'detach_vault_entry', { entryId: 'item-gmail', agentId: 'agent-scout' })
        expect(mocks.detachVaultEntry).toHaveBeenCalledWith('item-gmail', 'agent-scout', ADMIN)
    })

    it('lend a paid account through the paid apps, by the id list_vault gave it', async () => {
        const out = await dispatchVaultTool(ADMIN, 'attach_vault_entry', { entryId: 'conn-1', agentId: 'agent-scout' })

        expect(mocks.attachVaultPaidAccount).toHaveBeenCalledWith('linkedin', 'conn-1', 'agent-scout', ADMIN)
        expect(mocks.attachVaultEntry).not.toHaveBeenCalled()
        expect(out).toMatchObject({ id: 'conn-1', slug: 'linkedin' })

        await dispatchVaultTool(ADMIN, 'detach_vault_entry', { entryId: 'conn-1', agentId: 'agent-closer' })
        expect(mocks.detachVaultPaidAccount).toHaveBeenCalledWith('linkedin', 'conn-1', 'agent-closer', ADMIN)
        expect(mocks.detachVaultEntry).not.toHaveBeenCalled()
    })

    it('refuse to take back from one coworker an entry every coworker gets, which the box would keep handing it', async () => {
        shareGmailWithEveryone()

        await expect(dispatchVaultTool(ADMIN, 'detach_vault_entry', { entryId: 'item-gmail', agentId: 'agent-scout' })).rejects.toThrow('share_vault_entry')
        expect(mocks.detachVaultEntry).not.toHaveBeenCalled()
    })

    it('let the refusals of the Vault through, a clash or a Box the key does not manage', async () => {
        mocks.attachVaultEntry.mockRejectedValueOnce(new Error('Closer already gets GMAIL_TOKEN from another Vault entry'))

        await expect(dispatchVaultTool(ADMIN, 'attach_vault_entry', { entryId: 'item-gmail', agentId: 'agent-closer' })).rejects.toThrow('another Vault entry')
    })

    it('ask for both ids', async () => {
        await expect(dispatchVaultTool(ADMIN, 'attach_vault_entry', { entryId: 'item-gmail' })).rejects.toThrow('agentId')
        await expect(dispatchVaultTool(ADMIN, 'detach_vault_entry', { agentId: 'agent-scout' })).rejects.toThrow('entryId')
    })
})

describe('share_vault_entry', () => {
    it('shares an entry with every coworker through the Vault', async () => {
        shareGmailWithEveryone()

        const out = await dispatchVaultTool(ADMIN, 'share_vault_entry', { entryId: 'item-gmail', sharedWithAll: true })

        expect(mocks.shareVaultEntry).toHaveBeenCalledWith('item-gmail', true, ADMIN)
        expect(out).toMatchObject({ id: 'item-gmail', sharedWithAll: true })
    })

    it('refuses a paid account, lent coworker by coworker, and a missing flag', async () => {
        await expect(dispatchVaultTool(ADMIN, 'share_vault_entry', { entryId: 'conn-1', sharedWithAll: true })).rejects.toThrow('coworker by coworker')
        await expect(dispatchVaultTool(ADMIN, 'share_vault_entry', { entryId: 'item-gmail' })).rejects.toThrow('sharedWithAll')
        expect(mocks.shareVaultEntry).not.toHaveBeenCalled()
    })

    it('lets the admin-only refusal of the Vault through', async () => {
        mocks.shareVaultEntry.mockRejectedValueOnce(new Error('Only an admin can do this'))

        await expect(dispatchVaultTool(ADMIN, 'share_vault_entry', { entryId: 'item-gmail', sharedWithAll: true })).rejects.toThrow('Only an admin')
    })
})

describe('dispatchVaultTool', () => {
    it('hands every other name to the sharing tools', async () => {
        mocks.dispatchShareTool.mockResolvedValue({ shares: [] })

        await expect(dispatchVaultTool(ADMIN, 'list_agent_shares', {})).resolves.toEqual({ shares: [] })
        expect(mocks.dispatchShareTool).toHaveBeenCalledWith(ADMIN, 'list_agent_shares', {})
    })
})
