import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compileService, decompileService } from '@/lib/services/compiler'
import { type RegistryEntry, readOwnRegistry, readRegistry, removeRegistryEntry } from '@/lib/services/registry'
import { compileIntoVault } from '@/lib/vault/install'
import { createVaultItem, getVaultItem, patchVaultItem } from '@/lib/engine/vault-client'
import { deleteConnectorToken } from '@/lib/vault/tokens'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { assertCanChangeItem, vaultWritesEnabled } from './vault.service'
import { supportsVault } from '@/lib/engine/client'
import { installService, resetServiceConnection, uninstallService } from './services.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test' }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/compiler', () => ({
    compileService: vi.fn(async () => ({ toolNames: ['linear'], oauth: null, managed: null, composio: null, app: null })),
    decompileService: vi.fn(),
}))
vi.mock('@/lib/vault/install', () => ({
    VAULT_METHOD_KINDS: new Set(['oauth', 'key', 'stdio', 'none']),
    compileIntoVault: vi.fn(async () => ({ toolNames: ['linear'], oauth: { serverName: 'linear', url: 'https://mcp.linear.test' }, managed: null, composio: null, app: null, item: { id: 'item-1' } })),
}))
vi.mock('@/lib/vault/tokens', () => ({ deleteConnectorToken: vi.fn(async () => {}) }))
vi.mock('@/lib/engine/client', async importOriginal => ({ EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError, supportsVault: vi.fn(async () => true) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: ['engine-agent'] })), patchVaultItem: vi.fn(), createVaultItem: vi.fn() }))
vi.mock('./vault.service', async () => ({
    rethrowConflict: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).rethrowConflict,
    vaultWritesEnabled: vi.fn(async () => true),
    vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 }, byEngineId: new Map() })),
    assertCanChangeItem: vi.fn(async () => {}),
}))
vi.mock('@/lib/services/registry', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/services/registry')>()),
    readRegistry: vi.fn(),
    readOwnRegistry: vi.fn(async () => ({ services: {} })),
    upsertRegistryEntry: vi.fn(),
    removeRegistryEntry: vi.fn(),
}))
vi.mock('@/lib/services/embed', () => ({ embedText: vi.fn(async () => null), toVectorLiteral: vi.fn() }))
vi.mock('@/lib/services/rerank', () => ({ rerankRelevant: vi.fn() }))
vi.mock('@rerun/cloud/apps', () => ({ isAppSlug: () => false }))

const oauthMethod = { id: 'oauth', label: 'Sign in', kind: 'oauth', recommended: true, mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.test' }] }
const keyMethod = { id: 'key', label: 'API key', kind: 'key', recommended: false, inputs: [{ key: 'TOKEN', label: 'Token', secret: true }], envKeys: [{ key: 'LINEAR_TOKEN', fromInput: 'TOKEN' }] }
const composioMethod = { id: 'composio', label: 'Connect', kind: 'composio', recommended: false, composio: { toolkit: 'linear', authConfigId: 'ac', allowedTools: [] } }
const MANIFEST = { slug: 'linear', name: 'Linear', authMethods: [oauthMethod, keyMethod, composioMethod] }

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ status: 'active', config: {}, mcpServers: ['linear'], envKeys: [], skills: [], installedAt: '2026-10-01', ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readRegistry).mockResolvedValue({ services: {} })
    vi.mocked(vaultWritesEnabled).mockResolvedValue(true)
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'services' ? { data: { manifest: MANIFEST, enabled: true } } : undefined)).client)
})

describe('installService on a box that keeps a Vault', () => {
    it('puts a new account in the Vault, attached to the coworker installing it', async () => {
        const result = await installService('agent-1', 'linear', {}, 'oauth')
        expect(result.status).toBe('needs_auth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null, engineAgentId: 'engine-agent', createdBy: 'user-1', authMethodId: 'oauth' }))
        expect(compileService).not.toHaveBeenCalled()
    })

    it('records an install still missing its inputs as an entry to configure', async () => {
        const result = await installService('agent-1', 'linear', {}, 'key')
        expect(result.status).toBe('needs_config')
        expect(createVaultItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'service', slug: 'linear', status: 'needs_config', authMethodId: 'key', agentIds: ['engine-agent'] }))
        expect(compileIntoVault).not.toHaveBeenCalled()
    })

    it('compiles again the Vault entry the coworker already draws the app from, once allowed to', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        await installService('agent-1', 'linear', { TOKEN: 't' }, 'key')
        expect(assertCanChangeItem).toHaveBeenCalled()
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1' }))
    })

    it('marks an existing entry to configure in place rather than making another one', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        await installService('agent-1', 'linear', {}, 'key')
        expect(patchVaultItem).toHaveBeenCalledWith(expect.anything(), 'item-1', { status: 'needs_config', authMethodId: 'key' })
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('refuses to change an entry other coworkers use when the caller may not', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        vi.mocked(assertCanChangeItem).mockRejectedValueOnce(Object.assign(new Error('vaultSharedItem'), { code: 'vaultSharedItem' }))
        await expect(installService('agent-1', 'linear', { TOKEN: 't' }, 'key')).rejects.toMatchObject({ code: 'vaultSharedItem' })
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(getVaultItem).toHaveBeenCalled()
    })

    it("reconfigures an app the coworker holds in its own folder where it is", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry() } })
        await installService('agent-1', 'linear', { TOKEN: 't' }, 'key')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })

    it('never compiles a Vault entry into a sign-in the Vault does not hold', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        await expect(installService('agent-1', 'linear', {}, 'composio')).rejects.toMatchObject({ code: 'vaultMethodUnsupported' })
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(compileService).not.toHaveBeenCalled()
    })

    it('names the clash when the engine refuses the new entry', async () => {
        const { EngineRequestError } = await vi.importActual<typeof import('@/lib/engine/client')>('@/lib/engine/client')
        vi.mocked(compileIntoVault).mockRejectedValueOnce(new EngineRequestError(`rerun-engine POST /vault failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: 'engine-agent', itemId: 'other', kind: 'server', name: 'linear' }] })}`, 409))
        await expect(installService('agent-1', 'linear', {}, 'oauth')).rejects.toMatchObject({ code: 'vaultConflictSomeone', params: { name: 'linear' } })
    })

    it('keeps a sign-in the Vault does not hold yet in the coworker folder', async () => {
        await installService('agent-1', 'linear', {}, 'composio')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })
})

describe('installService on a box without a Vault, or with the feature off', () => {
    it('never reads the registry for the Vault on a box that keeps none', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileService).toHaveBeenCalled()
        expect(readRegistry).not.toHaveBeenCalled()
        vi.mocked(supportsVault).mockResolvedValue(true)
    })

    it('installs in the coworker folder as before', async () => {
        vi.mocked(vaultWritesEnabled).mockResolvedValue(false)
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(createVaultItem).not.toHaveBeenCalled()
    })
})

describe('uninstalling and resetting an entry the Vault lends', () => {
    it("detaches the coworker, and takes away the copy a migration left in its folder without revoking the item's Composio account", async () => {
        const vaultEntry = entry({ vaultItemId: 'item-1', composio: { toolkit: 'linear', serverName: 'linear', connectedAccountId: 'ca-1' } })
        const copy = entry({ composio: { toolkit: 'linear', serverName: 'linear', connectedAccountId: 'ca-1' } })
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: vaultEntry } })
        vi.mocked(readOwnRegistry).mockResolvedValue({ services: { linear: copy } })
        await uninstallService('agent-1', 'linear')
        expect(decompileService).toHaveBeenCalledTimes(2)
        expect(vi.mocked(decompileService).mock.calls[1][2].composio?.connectedAccountId).toBeUndefined()
        expect(removeRegistryEntry).toHaveBeenCalledWith(expect.anything(), 'engine-agent', 'linear')
    })

    it('refuses to take an entry shared with everyone from one coworker, and changes nothing', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', agentIds: [], sharedWithAll: true } as never)
        await expect(uninstallService('agent-1', 'linear')).rejects.toMatchObject({ code: 'vaultSharedItem' })
        expect(decompileService).not.toHaveBeenCalled()
        expect(removeRegistryEntry).not.toHaveBeenCalled()
    })

    it('drops the token of the entry, wherever it is kept', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1', oauth: { serverName: 'linear', url: 'https://mcp.linear.test' } }) } })
        const result = await resetServiceConnection('agent-1', 'linear')
        expect(result.mode).toBe('auth')
        expect(deleteConnectorToken).toHaveBeenCalledWith(expect.anything(), 'engine-agent', 'linear')
    })
})
