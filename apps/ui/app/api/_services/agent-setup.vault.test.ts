import { beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceActor } from '@/app/api/_auth/access'
import { supportsVault } from '@/lib/engine/client'
import { createVaultItem, patchVaultItem } from '@/lib/engine/vault-client'
import { compileService } from '@/lib/services/compiler'
import { type ServiceManifest, serviceManifestSchema } from '@/lib/services/manifest'
import { type RegistryEntry, readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { compileIntoVault } from '@/lib/vault/install'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { declareService } from './agent-setup.service'
import { installService } from './services.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('./agent.service', () => ({ createAgent: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test' }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/compiler', () => ({
    compileService: vi.fn(async () => ({ toolNames: ['notion'], oauth: { serverName: 'notion', url: 'https://mcp.notion.test' }, managed: null, composio: null, app: null })),
    decompileService: vi.fn(),
}))
vi.mock('@/lib/vault/install', () => ({
    VAULT_METHOD_KINDS: new Set(['oauth', 'key', 'stdio', 'none', 'managed', 'composio']),
    compileIntoVault: vi.fn(async () => ({ toolNames: ['notion'], oauth: { serverName: 'notion', url: 'https://mcp.notion.test' }, managed: null, composio: null, app: null, item: { id: 'item-1' } })),
}))
vi.mock('@/lib/vault/tokens', () => ({ deleteConnectorToken: vi.fn(async () => {}) }))
vi.mock('@/lib/engine/client', async importOriginal => ({ EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError, supportsVault: vi.fn(async () => true) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: ['engine-agent'] })), patchVaultItem: vi.fn(), createVaultItem: vi.fn(), detachVaultItem: vi.fn(), listVaultItems: vi.fn(async () => []) }))
vi.mock('./vault.service', async () => ({
    VaultUnavailableError: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).VaultUnavailableError,
    rethrowConflict: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).rethrowConflict,
    vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 }, byEngineId: new Map() })),
    assertCanChangeItem: vi.fn(async () => {}),
    canChangeItem: vi.fn(async () => true),
    lendVaultEntry: vi.fn(),
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

const oauth = { id: 'oauth', label: 'Sign in', kind: 'oauth', recommended: true, mcpServers: [{ name: 'notion', transport: 'http', url: 'https://mcp.notion.test' }] }
const key = { id: 'key', label: 'API key', kind: 'key', recommended: false, inputs: [{ key: 'TOKEN', label: 'Token', secret: true }], envKeys: [{ key: 'NOTION_TOKEN', fromInput: 'TOKEN' }] }
const paidApp = { id: 'app', label: 'Pick an account', kind: 'app', recommended: true, app: { appSlug: 'linkedin' }, mcpServers: [{ name: 'linkedin_pro', transport: 'http', url: 'https://hub.test/api/mcp/apps/linkedin' }] }

const manifest = (slug: string, authMethods: unknown[]): ServiceManifest => serviceManifestSchema.parse({ slug, name: slug, category: 'productivity', summary: slug, authMethods })
const NOTION = manifest('notion', [oauth, key])
const OAUTH_ONLY = manifest('linear', [oauth])
const LINKEDIN_PRO = manifest('linkedin-pro', [paidApp])

let registry: Record<string, RegistryEntry>
let vault: Record<string, RegistryEntry>
let catalog: ServiceManifest

beforeEach(() => {
    vi.clearAllMocks()
    registry = {}
    vault = {}
    catalog = NOTION
    vi.mocked(readRegistry).mockImplementation(async () => ({ services: { ...registry, ...vault } }))
    vi.mocked(createVaultItem).mockImplementation(async (_conn, input) => {
        vault[input.slug ?? ''] = { status: input.status ?? 'needs_config', config: {}, authMethodId: input.authMethodId, mcpServers: [], envKeys: [], skills: [], installedAt: '2026-11-20T00:00:00.000Z', vaultItemId: 'item-1', vaultSharedWithAll: false }
        return { id: 'item-1' } as Awaited<ReturnType<typeof createVaultItem>>
    })
    vi.mocked(upsertRegistryEntry).mockImplementation(async (_conn, _agent, entryKey, entry) => {
        registry[entryKey] = entry
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(
        fakeSupabase(table => {
            if (table === 'services') return { data: { manifest: catalog, enabled: true } }
            if (table === 'agents') return { data: { workspace_id: 7 } }
            if (table === 'workspaces') return { data: { plan: 'lifetime_restricted' } }
            return undefined
        }).client,
    )
})

describe('an app declared on a coworker, on a box that keeps a Vault', () => {
    it('waits in the Vault for its owner, and its sign-in lands there', async () => {
        await expect(declareService('agent-1', NOTION)).resolves.toBe('needs_config')
        expect(createVaultItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'service', slug: 'notion', status: 'needs_config', agentIds: ['engine-agent'] }))

        await installService('agent-1', 'notion', {}, 'oauth')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1', authMethodId: 'oauth', engineAgentId: 'engine-agent' }))
        expect(createVaultItem).toHaveBeenCalledTimes(1)
        expect(compileService).not.toHaveBeenCalled()
        expect(registry.notion).toBeUndefined()
    })

    it('is left as it is when the Vault already lends it to every coworker', async () => {
        vault.notion = { status: 'active', config: {}, authMethodId: 'oauth', mcpServers: ['notion'], envKeys: [], skills: [], installedAt: '2026-11-01T00:00:00.000Z', vaultItemId: 'shared-1', vaultSharedWithAll: true }
        await expect(declareService('agent-1', NOTION, workspaceActor(7))).resolves.toBe('compiled')
        expect(createVaultItem).not.toHaveBeenCalled()
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(compileService).not.toHaveBeenCalled()
    })

    it('goes to the Vault at once when its only way in is a sign-in', async () => {
        catalog = OAUTH_ONLY
        await expect(declareService('agent-1', OAUTH_ONLY)).resolves.toBe('compiled')
        expect(compileIntoVault).toHaveBeenCalledWith(expect.objectContaining({ itemId: null, authMethodId: 'oauth', engineAgentId: 'engine-agent' }))
        expect(compileService).not.toHaveBeenCalled()
    })

    it('stays with the coworker when it is a paid app, even on a plan that does not offer them', async () => {
        catalog = LINKEDIN_PRO
        await expect(declareService('agent-1', LINKEDIN_PRO)).resolves.toBe('compiled')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })
})

describe('an app declared on a coworker, on a box without a Vault', () => {
    beforeEach(() => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        return () => vi.mocked(supportsVault).mockResolvedValue(true)
    })

    it('waits in the coworker folder for its owner', async () => {
        await expect(declareService('agent-1', NOTION)).resolves.toBe('needs_config')
        expect(registry.notion).toMatchObject({ status: 'needs_config' })
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('is compiled into the coworker folder when its only way in is a sign-in', async () => {
        catalog = OAUTH_ONLY
        await expect(declareService('agent-1', OAUTH_ONLY)).resolves.toBe('compiled')
        expect(compileService).toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
    })
})
