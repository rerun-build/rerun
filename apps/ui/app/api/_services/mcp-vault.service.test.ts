import type { VaultItemSummary } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    listVault: vi.fn(),
    vaultPaidAccounts: vi.fn(),
    dispatchShareTool: vi.fn(),
}))

class VaultUnavailableError extends Error {}
class NoEngineError extends Error {}

vi.mock('./vault.service', () => ({ listVault: mocks.listVault, VaultUnavailableError }))
vi.mock('./vault-apps.service', () => ({ vaultPaidAccounts: mocks.vaultPaidAccounts }))
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

describe('dispatchVaultTool', () => {
    it('hands every other name to the sharing tools', async () => {
        mocks.dispatchShareTool.mockResolvedValue({ shares: [] })

        await expect(dispatchVaultTool(ADMIN, 'list_agent_shares', {})).resolves.toEqual({ shares: [] })
        expect(mocks.dispatchShareTool).toHaveBeenCalledWith(ADMIN, 'list_agent_shares', {})
    })
})
