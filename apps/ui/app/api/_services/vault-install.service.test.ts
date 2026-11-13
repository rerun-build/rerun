import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVaultItem } from '@/lib/engine/vault-client'
import { addVaultMcp, addVaultSecret, vaultServerName } from './vault-install.service'
import { assertManagesCoworker } from './vault.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ createVaultItem: vi.fn(async (_c: unknown, input: Record<string, unknown>) => ({ id: 'new', ...input })), attachVaultItem: vi.fn(), getVaultItem: vi.fn(), listVaultItems: vi.fn() }))
vi.mock('./services.service', () => ({ loadManifest: vi.fn(), toAuthMethodSummaries: vi.fn() }))
vi.mock('./vault.service', async () => ({
    rethrowConflict: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).rethrowConflict,
    vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 }, conn: {}, coworkers: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box' }], byEngineId: new Map() })),
    assertCanAdd: vi.fn(async () => {}),
    assertCanChangeItem: vi.fn(async () => {}),
    assertManagesCoworker: vi.fn(async (_actor: unknown, coworker: unknown) => coworker),
}))

beforeEach(() => vi.clearAllMocks())

describe('addVaultSecret', () => {
    it('stores one variable, attached to the coworkers picked', async () => {
        await addVaultSecret({ name: 'Stripe key', key: ' STRIPE_API_KEY ', value: 'sk_live_1', agentIds: ['alice'] })
        expect(createVaultItem).toHaveBeenCalledWith({}, { kind: 'secret', name: 'Stripe key', env: { STRIPE_API_KEY: 'sk_live_1' }, agentIds: ['e-alice'], createdBy: 'user-1' })
        expect(assertManagesCoworker).toHaveBeenCalled()
    })
})

describe('addVaultMcp', () => {
    it("keeps a header's secret in the entry's variables, the server only naming it", async () => {
        const item = await addVaultMcp({ name: 'Company docs', url: 'https://docs.acme.test/mcp', headers: [{ name: 'Authorization', value: 'Bearer abc' }] })
        const input = vi.mocked(createVaultItem).mock.calls[0][1]
        expect(input).toMatchObject({ kind: 'mcp', name: 'Company docs', env: { VAULT_COMPANY_DOCS_AUTHORIZATION: 'Bearer abc' } })
        expect(input.mcpServers).toEqual([{ name: 'company-docs', url: 'https://docs.acme.test/mcp', headers: { Authorization: '${VAULT_COMPANY_DOCS_AUTHORIZATION}' } }])
        expect(input).not.toHaveProperty('oauth')
        expect(JSON.stringify(input.mcpServers)).not.toContain('abc')
        expect(item.id).toBe('new')
    })

    it('offers a browser sign-in to a remote server with no key, and none to a command', async () => {
        await addVaultMcp({ name: 'Linear', url: 'https://mcp.linear.app/mcp' })
        expect(vi.mocked(createVaultItem).mock.calls[0][1]).toMatchObject({ oauth: { serverName: 'linear', url: 'https://mcp.linear.app/mcp' } })
        await addVaultMcp({ name: 'Local files', command: 'npx', args: ['-y', 'files-mcp'] })
        const local = vi.mocked(createVaultItem).mock.calls[1][1]
        expect(local).not.toHaveProperty('oauth')
        expect(local.mcpServers).toEqual([{ name: 'local-files', command: 'npx', args: ['-y', 'files-mcp'], headers: {} }])
    })

    it('needs exactly one of an address and a command', async () => {
        await expect(addVaultMcp({ name: 'x' })).rejects.toMatchObject({ code: 'vaultMcpTarget' })
        await expect(addVaultMcp({ name: 'x', url: 'https://a.test', command: 'npx' })).rejects.toMatchObject({ code: 'vaultMcpTarget' })
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('names a server after the entry, within what a server name may hold', () => {
        expect(vaultServerName('Company Docs (prod)')).toBe('company-docs-prod')
        expect(vaultServerName('!!!')).toBe('mcp')
        expect(vaultServerName('x'.repeat(100))).toHaveLength(64)
    })
})
