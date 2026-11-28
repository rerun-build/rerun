import type { VaultItemSummary } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compileService, decompileService } from '@/lib/services/compiler'
import { type RegistryEntry, readOwnRegistry, readRegistry, removeRegistryEntry } from '@/lib/services/registry'
import { compileIntoVault } from '@/lib/vault/install'
import { attachVaultItem, createVaultItem, detachVaultItem, getVaultItem, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { deleteConnectorToken } from '@/lib/vault/tokens'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { assertCanChangeItem, canChangeItem, lendVaultEntry, vaultContext } from './vault.service'
import { supportsVault } from '@/lib/engine/client'
import { installService, resetServiceConnection, uninstallService } from './services.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async (agentId: string) => ({ conn: { baseUrl: 'https://engine.test' }, engineAgentId: agentId === 'foreman' ? 'foreman' : 'engine-agent' })) }))
vi.mock('@/lib/services/compiler', () => ({
    compileService: vi.fn(async () => ({ toolNames: ['linear'], oauth: null, managed: null, composio: null, app: null })),
    decompileService: vi.fn(),
}))
vi.mock('@/lib/vault/install', () => ({
    VAULT_METHOD_KINDS: new Set(['oauth', 'key', 'stdio', 'none', 'managed', 'composio']),
    compileIntoVault: vi.fn(async () => ({ toolNames: ['linear'], oauth: { serverName: 'linear', url: 'https://mcp.linear.test' }, managed: null, composio: null, app: null, item: { id: 'item-1' } })),
}))
vi.mock('@/lib/vault/tokens', () => ({ deleteConnectorToken: vi.fn(async () => {}) }))
vi.mock('@/lib/engine/client', async importOriginal => ({ EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError, supportsVault: vi.fn(async () => true) }))
vi.mock('@/lib/engine/vault-client', () => ({
    getVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: ['engine-agent'] })),
    patchVaultItem: vi.fn(),
    createVaultItem: vi.fn(),
    detachVaultItem: vi.fn(),
    listVaultItems: vi.fn(async () => []),
    attachVaultItem: vi.fn(async (_conn: unknown, id: string, engineAgentId: string) => ({ id, agentIds: [engineAgentId] })),
}))
vi.mock('./vault.service', async () => ({
    VaultUnavailableError: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).VaultUnavailableError,
    rethrowConflict: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).rethrowConflict,
    vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 }, byEngineId: new Map() })),
    assertCanChangeItem: vi.fn(async () => {}),
    canChangeItem: vi.fn(async () => true),
    lendVaultEntry: vi.fn(async (_ctx: unknown, item: VaultItemSummary, engineAgentId: string) => ({ ...item, agentIds: [...item.agentIds, engineAgentId] })),
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
const appMethod = { id: 'app', label: 'Pick an account', kind: 'app', recommended: false, app: { appSlug: 'linkedin' }, mcpServers: [{ name: 'linear_pro', transport: 'http', url: 'https://hub.test/api/mcp/apps/linkedin' }] }
const MANIFEST = { slug: 'linear', name: 'Linear', authMethods: [oauthMethod, keyMethod, composioMethod, appMethod] }

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ status: 'active', config: {}, mcpServers: ['linear'], envKeys: [], skills: [], installedAt: '2026-10-01', ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readRegistry).mockResolvedValue({ services: {} })
    vi.mocked(listVaultItems).mockResolvedValue([])
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
        await expect(installService('agent-1', 'linear', {}, 'app')).rejects.toMatchObject({ code: 'vaultMethodUnsupported' })
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(compileService).not.toHaveBeenCalled()
    })

    it('names the clash when the engine refuses the new entry', async () => {
        const { EngineRequestError } = await vi.importActual<typeof import('@/lib/engine/client')>('@/lib/engine/client')
        vi.mocked(compileIntoVault).mockRejectedValueOnce(new EngineRequestError(`rerun-engine POST /vault failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: 'engine-agent', itemId: 'other', kind: 'server', name: 'linear' }] })}`, 409))
        await expect(installService('agent-1', 'linear', {}, 'oauth')).rejects.toMatchObject({ code: 'vaultConflictSomeone', params: { name: 'linear' } })
    })

    it('puts a Composio account in the Vault too', async () => {
        await installService('agent-1', 'linear', {}, 'composio')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ authMethodId: 'composio' }))
        expect(compileService).not.toHaveBeenCalled()
    })

    it('keeps a sign-in the Vault does not hold yet in the coworker folder', async () => {
        await installService('agent-1', 'linear', {}, 'app')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })
})

const vaultItem = (over: Partial<VaultItemSummary> = {}): VaultItemSummary => ({
    id: 'held',
    kind: 'service',
    slug: 'linear',
    name: 'Linear',
    status: 'active',
    authMethodId: 'oauth',
    config: {},
    mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.test', args: [], env: {}, headers: {} }],
    skills: [],
    envKeys: [],
    tokens: [],
    agentIds: [],
    sharedWithAll: false,
    createdBy: 'user-1',
    createdAt: '2026-11-25T21:38:54.411Z',
    updatedAt: '2026-11-25T21:38:54.411Z',
    ...over,
})

describe('installService on an app the Vault already holds (RER-438)', () => {
    it('takes back the entry a coworker left in the Vault rather than making another one', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'orphan', authMethodId: 'key', envKeys: ['LINEAR_TOKEN'] })])
        await installService('agent-1', 'linear', { TOKEN: 'new' }, 'key')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'orphan', engineAgentId: 'engine-agent' }))
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('lends an account the Vault already has connected, with no second sign-in', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', agentIds: ['other-agent'] })])
        const result = await installService('agent-1', 'linear', {}, 'oauth')
        expect(result).toMatchObject({ status: 'installed', key: 'linear', toolNames: ['linear'] })
        expect(lendVaultEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'shared' }), 'engine-agent')
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('lends a connected account even when the install had nothing typed yet', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', authMethodId: 'key', agentIds: ['other-agent'] })])
        const result = await installService('agent-1', 'linear', {}, 'key')
        expect(result.status).toBe('installed')
        expect(lendVaultEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'shared' }), 'engine-agent')
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('keeps a connected entry other coworkers use as it is: a typed key makes an entry of its own', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', authMethodId: 'key', agentIds: ['other-agent'] })])
        await installService('agent-1', 'linear', { TOKEN: 'new' }, 'key')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
    })

    it('keeps a connected entry other coworkers use as it is when another sign-in is picked', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', authMethodId: 'key', envKeys: ['LINEAR_TOKEN'], agentIds: ['other-agent'] })])
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
    })

    it('declares an app waiting for its owner without touching the connected entry other coworkers use', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', authMethodId: 'key', agentIds: ['other-agent'] })])
        const result = await installService('agent-1', 'linear', {}, undefined, undefined, { pending: true })
        expect(result.status).toBe('needs_config')
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(createVaultItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'needs_config', agentIds: ['engine-agent'] }))
    })

    it('makes an entry of its own when the caller may not change the waiting one', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'waiting', status: 'needs_config', authMethodId: 'key', agentIds: ['other-agent'] })])
        vi.mocked(canChangeItem).mockResolvedValueOnce(false)
        await installService('agent-1', 'linear', { TOKEN: 'new' }, 'key')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
    })

    it('lends a connected entry nobody uses any more when nothing is typed', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'orphan' })])
        const result = await installService('agent-1', 'linear', {}, 'oauth')
        expect(result.status).toBe('installed')
        expect(lendVaultEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'orphan' }), 'engine-agent')
    })

    it('never reuses an entry of the Vault for an install that asks for its own', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', agentIds: ['other-agent'] })])
        await installService('agent-1', 'linear', {}, 'oauth', undefined, { ownEntry: true })
        expect(listVaultItems).not.toHaveBeenCalled()
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
    })

    it('configures in place an entry still waiting for its sign-in, and attaches the coworker to it', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'waiting', status: 'needs_config', authMethodId: 'key' })])
        await installService('agent-1', 'linear', {}, 'key')
        expect(patchVaultItem).toHaveBeenCalledWith(expect.anything(), 'waiting', { status: 'needs_config', authMethodId: 'key' })
        expect(attachVaultItem).toHaveBeenCalledWith(expect.anything(), 'waiting', 'engine-agent')
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('prefers the connected account the most coworkers use', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([
            vaultItem({ id: 'orphan', status: 'needs_auth' }),
            vaultItem({ id: 'one', agentIds: ['a'] }),
            vaultItem({ id: 'many', agentIds: ['a', 'b'] }),
        ])
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(lendVaultEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'many' }), 'engine-agent')
    })

    it('leaves another account of the app, another app and an entry shared with everyone alone', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'second', instanceId: 'k3x9ab' }), vaultItem({ id: 'other-app', slug: 'notion' }), vaultItem({ id: 'all', sharedWithAll: true })])
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
    })

    it('still gives another account asked for its own entry', async () => {
        const manifest = { ...MANIFEST, authMethods: [oauthMethod, keyMethod, composioMethod] }
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'services' ? { data: { manifest, enabled: true } } : undefined)).client)
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', agentIds: ['other-agent'] })])
        await installService('agent-1', 'linear', {}, 'oauth', undefined, { newInstance: true })
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
    })

    it("never lets a coworker's own call help itself to an account of the Vault", async () => {
        vi.mocked(listVaultItems).mockResolvedValue([vaultItem({ id: 'shared', agentIds: ['other-agent'] })])
        vi.mocked(vaultContext).mockResolvedValueOnce({ actor: { kind: 'workspace', workspaceId: 7 }, byEngineId: new Map() } as never)
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null }))
        expect(lendVaultEntry).not.toHaveBeenCalled()
        expect(listVaultItems).not.toHaveBeenCalled()
    })
})

describe('installService on a box without a Vault', () => {
    it('never reads the registry for the Vault on a box that keeps none', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        await installService('agent-1', 'linear', {}, 'oauth')
        expect(compileService).toHaveBeenCalled()
        expect(readRegistry).not.toHaveBeenCalled()
        vi.mocked(supportsVault).mockResolvedValue(true)
    })
})

describe('the Chief of Staff, which holds its apps in the Vault only', () => {
    beforeEach(() => {
        const manifest = { ...MANIFEST, authMethods: [oauthMethod, keyMethod, composioMethod] }
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'services' ? { data: { manifest, enabled: true } } : undefined)).client)
    })

    it('puts the app it connects in the Vault, attached to it', async () => {
        await installService('foreman', 'linear', {}, 'key')
        expect(createVaultItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'service', slug: 'linear', status: 'needs_config', agentIds: ['foreman'] }))

        await installService('foreman', 'linear', {}, 'oauth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null, engineAgentId: 'foreman' }))
        expect(compileService).not.toHaveBeenCalled()
    })

    it('leaves an app declared for its owner pending in the Vault, even with nothing missing', async () => {
        await expect(installService('foreman', 'linear', {}, 'oauth', undefined, { pending: true })).resolves.toMatchObject({ status: 'needs_config', key: 'linear' })
        expect(createVaultItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'service', slug: 'linear', status: 'needs_config', authMethodId: 'oauth', agentIds: ['foreman'] }))
        expect(compileIntoVault).not.toHaveBeenCalled()
    })

    it('keeps an app in its own folder on a box without a Vault, like a coworker', async () => {
        vi.mocked(supportsVault).mockResolvedValueOnce(false)
        await installService('foreman', 'linear', {}, 'oauth')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })

    it('detaches itself from the entry on uninstall, and leaves the account in the Vault', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        await uninstallService('foreman', 'linear')
        expect(detachVaultItem).toHaveBeenCalledWith(expect.anything(), 'item-1', 'foreman')
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
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1', vaultSharedWithAll: true }) } })
        await expect(uninstallService('agent-1', 'linear')).rejects.toMatchObject({ code: 'vaultSharedItem' })
        expect(decompileService).not.toHaveBeenCalled()
        expect(removeRegistryEntry).not.toHaveBeenCalled()
    })

    it("leaves a Composio account the coworker connected itself where it is, under an entry of another account", async () => {
        const vaultEntry = entry({ vaultItemId: 'item-1', composio: { toolkit: 'linear', serverName: 'linear', connectedAccountId: 'ca-1' } })
        const own = entry({ composio: { toolkit: 'linear', serverName: 'linear', connectedAccountId: 'ca-own' } })
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: vaultEntry } })
        vi.mocked(readOwnRegistry).mockResolvedValue({ services: { linear: own } })
        await uninstallService('agent-1', 'linear')
        expect(decompileService).toHaveBeenCalledTimes(1)
        expect(vi.mocked(decompileService).mock.calls[0][2].vaultItemId).toBe('item-1')
        expect(detachVaultItem).toHaveBeenCalledWith(expect.anything(), 'item-1', 'engine-agent')
        expect(removeRegistryEntry).not.toHaveBeenCalled()
    })

    it('only detaches a coworker that holds no copy of the entry', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1' }) } })
        vi.mocked(readOwnRegistry).mockResolvedValue({ services: {} })
        await uninstallService('agent-1', 'linear')
        expect(detachVaultItem).toHaveBeenCalledWith(expect.anything(), 'item-1', 'engine-agent')
        expect(removeRegistryEntry).not.toHaveBeenCalled()
    })

    it('drops the token of the entry, wherever it is kept', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { linear: entry({ vaultItemId: 'item-1', oauth: { serverName: 'linear', url: 'https://mcp.linear.test' } }) } })
        const result = await resetServiceConnection('agent-1', 'linear')
        expect(result.mode).toBe('auth')
        expect(deleteConnectorToken).toHaveBeenCalledWith(expect.anything(), 'engine-agent', 'linear')
    })
})
