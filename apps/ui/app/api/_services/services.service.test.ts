import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compileService, decompileService } from '@/lib/services/compiler'
import { getMcpServerStatuses, supportsVault } from '@/lib/engine/client'
import { deleteVaultItem, patchVaultItem, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { compileIntoVault } from '@/lib/vault/install'
import { AppError } from '@/lib/i18n/action-error'
import { type RegistryEntry, type ServiceRegistry, readRegistry, removeRegistryEntry, upsertRegistryEntry } from '@/lib/services/registry'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { syncAppConnector } from '@rerun/cloud/apps.server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { searchDocs } from '@/lib/foreman/search-docs'
import { fetchPublic } from '@/lib/net/public-fetch'
import { dispatchHubTool, getServiceDetails, installService, installedFromRegistry, listInstalledServices, markServiceAuthorized, resetServiceConnection, searchServices, uninstallService } from './services.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: {}, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/compiler', () => ({
    compileService: vi.fn(async () => ({ toolNames: [], oauth: null, managed: null, composio: { toolkit: 'gmail', serverName: 'gmail' }, app: null })),
    decompileService: vi.fn(),
}))
vi.mock('@/lib/services/registry', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/services/registry')>()),
    readRegistry: vi.fn(),
    upsertRegistryEntry: vi.fn(),
    removeRegistryEntry: vi.fn(),
}))
vi.mock('@/lib/engine/client', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/engine/client')>()),
    supportsVault: vi.fn(async () => false),
    getMcpServerStatuses: vi.fn(async () => []),
}))
vi.mock('@/lib/engine/vault-client', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/engine/vault-client')>()),
    patchVaultItem: vi.fn(),
    updateVaultItemEnv: vi.fn(),
    deleteVaultItem: vi.fn(),
}))
vi.mock('@/lib/vault/install', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/vault/install')>()), compileIntoVault: vi.fn() }))
vi.mock('@/app/api/_services/vault.service', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_services/vault.service')>()),
    vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1' }, byEngineId: new Map() })),
}))
vi.mock('@/lib/services/embed', () => ({ embedText: vi.fn(async () => null), toVectorLiteral: vi.fn() }))
vi.mock('@/lib/services/rerank', () => ({ rerankRelevant: vi.fn() }))
vi.mock('@/lib/foreman/search-docs', () => ({ searchDocs: vi.fn() }))
// The open source build resolves `@rerun/cloud` to `cloud-oss`, with no paid apps; the reset logic under test is the same in both.
vi.mock('@/lib/foreman/agent-row', () => ({ ensureForemanAgentRow: vi.fn(async () => 'foreman-row') }))
vi.mock('@rerun/cloud/apps.server', () => ({ syncAppConnector: vi.fn(async () => 0), unbindAgent: vi.fn() }))
vi.mock('@rerun/cloud/apps', () => ({ isAppSlug: (value: unknown) => value === 'whatsapp' }))
vi.mock('@/lib/net/public-fetch', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/net/public-fetch')>()), fetchPublic: vi.fn() }))

const composioMethod = { id: 'composio', label: 'Connect', kind: 'composio', recommended: true, composio: { toolkit: 'gmail', authConfigId: 'ac', allowedTools: [] } }
const appMethod = { id: 'app', label: 'Connect', kind: 'app', recommended: true, app: { appSlug: 'whatsapp' } }
const bufferKeyInput = { key: 'BUFFER_KEY', type: 'password', label: 'Buffer personal API key', secret: true, required: true }
const bufferServer = { env: {}, url: 'https://mcp.buffer.com/mcp', args: [], name: 'buffer', headers: { Authorization: 'Bearer ${input.BUFFER_KEY}' }, transport: 'http' }
const MANIFESTS: Record<string, unknown> = {
    buffer: { slug: 'buffer', name: 'Buffer', inputs: [bufferKeyInput], mcpServers: [bufferServer] },
    'linear-key': { slug: 'linear-key', name: 'Linear', inputs: [{ ...bufferKeyInput, key: 'LINEAR_KEY' }], mcpServers: [{ ...bufferServer, name: 'linear', headers: { Authorization: 'Bearer ${input.LINEAR_KEY}' } }] },
    'public-mcp': { slug: 'public-mcp', name: 'Public MCP', mcpServers: [{ ...bufferServer, name: 'public-mcp', headers: {} }] },
    'optional-key': { slug: 'optional-key', name: 'Optional Key', inputs: [{ ...bufferKeyInput, key: 'OPTIONAL_KEY', required: false }], mcpServers: [{ ...bufferServer, name: 'optional-key', headers: { Authorization: 'Bearer ${input.OPTIONAL_KEY}' } }] },
    'stdio-tool': { slug: 'stdio-tool', name: 'Stdio Tool', inputs: [{ ...bufferKeyInput, key: 'TOOL_KEY' }], mcpServers: [{ name: 'stdio-tool', command: 'npx', args: ['stdio-tool'], env: { TOOL_KEY: '${input.TOOL_KEY}' } }] },
    gmail: { slug: 'gmail', name: 'Gmail', authMethods: [composioMethod] },
    'linkedin-pro': { slug: 'linkedin-pro', name: 'LinkedIn Pro', authMethods: [composioMethod] },
    'whatsapp-pro': { slug: 'whatsapp-pro', name: 'WhatsApp Pro', authMethods: [appMethod] },
    shopify: {
        slug: 'shopify',
        name: 'Shopify',
        authMethods: [
            {
                id: 'client_credentials',
                label: 'Client ID and secret',
                kind: 'stdio',
                recommended: true,
                inputs: [
                    { key: 'SHOPIFY_CLIENT_ID', type: 'text', label: 'Client ID', required: true },
                    { key: 'SHOPIFY_CLIENT_SECRET', type: 'password', label: 'Client secret', secret: true, required: true },
                    { key: 'MYSHOPIFY_DOMAIN', type: 'text', label: 'Store domain', required: true },
                ],
                mcpServers: [{ name: 'shopify', command: 'npx', args: ['-y', 'cob-shopify-mcp', 'start'], env: { SHOPIFY_CLIENT_ID: '${input.SHOPIFY_CLIENT_ID}', SHOPIFY_CLIENT_SECRET: '${input.SHOPIFY_CLIENT_SECRET}', SHOPIFY_STORE_DOMAIN: '${input.MYSHOPIFY_DOMAIN}' } }],
            },
            {
                id: 'default',
                label: 'Access token',
                kind: 'stdio',
                inputs: [
                    { key: 'SHOPIFY_ACCESS_TOKEN', type: 'password', label: 'Admin API access token', secret: true, required: true },
                    { key: 'MYSHOPIFY_DOMAIN', type: 'text', label: 'Store domain', required: true },
                ],
                mcpServers: [{ name: 'shopify', command: 'npx', args: ['-y', 'cob-shopify-mcp', 'start'], env: { SHOPIFY_ACCESS_TOKEN: '${input.SHOPIFY_ACCESS_TOKEN}', SHOPIFY_STORE_DOMAIN: '${input.MYSHOPIFY_DOMAIN}' } }],
            },
        ],
    },
}

function eqSlug(calls: readonly { method: string; args: unknown[] }[]): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === 'slug')?.args[1]
}

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ status: 'active', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '2026-10-01', ...over })

// The agent's workspace, read by the paid-apps rule: absent from the fake unless a test sets it.
let workspacePlan: string | null = null

function useRegistry(reg: ServiceRegistry) {
    vi.mocked(readRegistry).mockResolvedValue(reg)
}

beforeEach(() => {
    vi.clearAllMocks()
    workspacePlan = null
    vi.mocked(createServiceRoleClient).mockReturnValue(
        fakeSupabase((table, calls) => {
            if (table === 'agents') return workspacePlan ? { data: { workspace_id: 1 } } : undefined
            if (table === 'workspaces') return { data: { plan: workspacePlan } }
            if (table !== 'services') return undefined
            const slug = eqSlug(calls)
            if (typeof slug === 'string') return { data: MANIFESTS[slug] ? { manifest: MANIFESTS[slug], enabled: true } : null }
            return {
                data: [
                    { slug: 'gmail', name: 'Gmail', icon: null, category: 'productivity', summary: '', manifest: MANIFESTS.gmail, verified: true },
                    { slug: 'notion', name: 'Notion', icon: null, category: 'productivity', summary: '', manifest: { slug: 'notion', name: 'Notion' }, verified: true },
                    { slug: 'whatsapp-pro', name: 'WhatsApp Pro', icon: null, category: 'communication', summary: '', manifest: MANIFESTS['whatsapp-pro'], verified: true },
                ],
            }
        }).client,
    )
})

describe('installService', () => {
    it('allocates a new account when the app takes several', async () => {
        useRegistry({ services: { gmail: entry() } })
        const result = await installService('agent', 'gmail', {}, undefined, undefined, { newInstance: true })

        expect(result.key).toMatch(/^gmail@[a-z0-9]{6}$/)
        const [, , , , , instance] = vi.mocked(compileService).mock.calls[0]
        expect(instance).toMatchObject({ key: result.key, label: 'Gmail 2' })
    })

    it('allocates a new account of an app with a key, like any app but a paid one', async () => {
        useRegistry({ services: { 'stdio-tool': entry() } })
        const result = await installService('agent', 'stdio-tool', { TOOL_KEY: 'second' }, undefined, undefined, { newInstance: true })

        expect(result.key).toMatch(/^stdio-tool@[a-z0-9]{6}$/)
        expect(vi.mocked(compileService).mock.calls[0][5]).toMatchObject({ key: result.key, label: 'Stdio Tool 2' })
    })

    it('ignores newInstance on a paid app', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'
        const result = await installService('agent', 'whatsapp-pro', {}, undefined, undefined, { newInstance: true })

        expect(result.key).toBe('whatsapp-pro')
        expect(vi.mocked(compileService).mock.calls[0][5]).toBeUndefined()
    })

    it('reinstalls the base account when an instance key names a paid app', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'
        const result = await installService('agent', 'whatsapp-pro@abc123')

        expect(result.key).toBe('whatsapp-pro')
        expect(vi.mocked(compileService).mock.calls[0][5]).toBeUndefined()
    })

    it('reinstalls an existing extra account under its key and keeps its label', async () => {
        useRegistry({ services: { gmail: entry(), 'gmail@k3x9ab': entry({ instanceId: 'k3x9ab', label: 'ops@acme.com' }) } })
        const result = await installService('agent', 'gmail@k3x9ab')

        expect(result.key).toBe('gmail@k3x9ab')
        expect(vi.mocked(compileService).mock.calls[0][5]).toEqual({ key: 'gmail@k3x9ab', instanceId: 'k3x9ab', label: 'ops@acme.com' })
    })
})

// RER-28: a Buffer key Buffer refuses was installed as "configured", and the coworker met the 401 at its first run.
describe('installService with a key the app refuses', () => {
    const KEY = { BUFFER_KEY: 'not-a-real-buffer-key' }
    const compiledBuffer = { toolNames: ['buffer'], oauth: null, managed: null, composio: null, app: null }
    const refused = { name: 'buffer', status: 'needs_auth' as const, transport: 'http' as const, toolCount: 0, error: 'Unauthorized: Invalid or expired token (HTTP 401)' }

    beforeEach(() => {
        vi.mocked(compileService).mockResolvedValue(compiledBuffer)
        useRegistry({ services: { buffer: entry({ mcpServers: ['buffer'], envKeys: ['RERUN_SVC_BUFFER_BUFFER_KEY'], skills: ['buffer-usage'] }) } })
    })

    afterEach(() => {
        vi.mocked(compileService).mockResolvedValue({ toolNames: [], oauth: null, managed: null, composio: { toolkit: 'gmail', serverName: 'gmail' }, app: null })
        vi.mocked(getMcpServerStatuses).mockResolvedValue([])
        vi.mocked(supportsVault).mockResolvedValue(false)
    })

    it('refuses the install, takes the server back off the coworker and leaves the app to configure', async () => {
        vi.mocked(getMcpServerStatuses).mockResolvedValue([refused])

        const install = installService('agent', 'buffer', KEY)

        await expect(install).rejects.toBeInstanceOf(AppError)
        await expect(install).rejects.toMatchObject({ code: 'serviceKeyRejected', params: { name: 'Buffer' } })
        expect(getMcpServerStatuses).toHaveBeenCalledWith({}, 'engine-agent', ['buffer'])
        expect(vi.mocked(decompileService).mock.calls[0][2]).toMatchObject({ mcpServers: ['buffer'], envKeys: ['RERUN_SVC_BUFFER_BUFFER_KEY'] })
        expect(upsertRegistryEntry).toHaveBeenLastCalledWith({}, 'engine-agent', 'buffer', expect.objectContaining({ status: 'needs_config', mcpServers: [], envKeys: [] }))
    })

    it('installs a key the app accepts', async () => {
        vi.mocked(getMcpServerStatuses).mockResolvedValue([{ name: 'buffer', status: 'connected', transport: 'http', toolCount: 12 }])

        await expect(installService('agent', 'buffer', KEY)).resolves.toMatchObject({ status: 'installed', key: 'buffer' })
        expect(decompileService).not.toHaveBeenCalled()
    })

    type Statuses = () => ReturnType<typeof getMcpServerStatuses>
    it.each<[string, Statuses]>([
        ['a server in error', async () => [{ name: 'buffer', status: 'error', transport: 'http', toolCount: 0, error: 'no answer within 15s' }]],
        ['an engine without the status route', async () => null],
        ['an engine that does not answer', async () => Promise.reject(new Error('fetch failed'))],
    ])('keeps the install on %s: only a refusal of the key blocks it', async (_, statuses) => {
        vi.mocked(getMcpServerStatuses).mockImplementation(statuses)

        await expect(installService('agent', 'buffer', KEY)).resolves.toMatchObject({ status: 'installed' })
        expect(decompileService).not.toHaveBeenCalled()
    })

    it('dials nothing for a sign-in method', async () => {
        await installService('agent', 'gmail')

        expect(getMcpServerStatuses).not.toHaveBeenCalled()
    })

    it.each([
        ['a remote server that takes no key', 'public-mcp', {}],
        ['an optional key left blank', 'optional-key', { OPTIONAL_KEY: ' ' }],
    ])('dials nothing for %s', async (_, slug, values) => {
        await installService('agent', slug, values)

        expect(getMcpServerStatuses).not.toHaveBeenCalled()
    })

    it('removes an account the install had just added, so a retry leaves no account to configure behind', async () => {
        useRegistry({ services: {} })
        vi.mocked(getMcpServerStatuses).mockResolvedValue([refused])

        const install = installService('agent', 'linear-key', { LINEAR_KEY: 'wrong' }, undefined, undefined, { newInstance: true })

        await expect(install).rejects.toMatchObject({ code: 'serviceKeyRejected', params: { name: 'Linear' } })
        expect(removeRegistryEntry).toHaveBeenCalledWith({}, 'engine-agent', expect.stringMatching(/^linear-key@[a-z0-9]{6}$/))
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })

    it('dials nothing for a server it would have to start', async () => {
        await installService('agent', 'stdio-tool', { TOOL_KEY: 'x' })

        expect(getMcpServerStatuses).not.toHaveBeenCalled()
    })

    it('empties the Vault item and leaves it to configure', async () => {
        useRegistry({ services: {} })
        vi.mocked(supportsVault).mockResolvedValue(true)
        vi.mocked(compileIntoVault).mockResolvedValue({ ...compiledBuffer, item: { id: 'item-1', envKeys: ['RERUN_SVC_BUFFER_BUFFER_KEY'] } } as never)
        vi.mocked(getMcpServerStatuses).mockResolvedValue([refused])

        await expect(installService('agent', 'buffer', KEY)).rejects.toMatchObject({ code: 'serviceKeyRejected' })
        expect(updateVaultItemEnv).toHaveBeenCalledWith({}, 'item-1', { remove: ['RERUN_SVC_BUFFER_BUFFER_KEY'] })
        expect(patchVaultItem).toHaveBeenCalledWith({}, 'item-1', { status: 'needs_config', mcpServers: [], skills: [] })
        expect(decompileService).not.toHaveBeenCalled()
        expect(deleteVaultItem).not.toHaveBeenCalled()
    })

    it('deletes the Vault item of an account the install had just added', async () => {
        useRegistry({ services: {} })
        vi.mocked(supportsVault).mockResolvedValue(true)
        vi.mocked(compileIntoVault).mockResolvedValue({ ...compiledBuffer, item: { id: 'item-1', envKeys: ['RERUN_SVC_LINEAR_KEY_LINEAR_KEY'] } } as never)
        vi.mocked(getMcpServerStatuses).mockResolvedValue([refused])

        await expect(installService('agent', 'linear-key', { LINEAR_KEY: 'wrong' }, undefined, undefined, { newInstance: true })).rejects.toMatchObject({ code: 'serviceKeyRejected' })
        expect(deleteVaultItem).toHaveBeenCalledWith({}, 'item-1')
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(updateVaultItemEnv).not.toHaveBeenCalled()
    })
})

// RER-317: a Client ID and secret of a Dev Dashboard app not installed on the store were saved as connected,
// and Shopify only said app_not_installed at the coworker's first call.
describe('installService of Shopify with a Client ID and secret', () => {
    const CREDENTIALS = { SHOPIFY_CLIENT_ID: 'client-id', SHOPIFY_CLIENT_SECRET: 'shpss_secret', MYSHOPIFY_DOMAIN: 'walking-store.myshopify.com' }

    beforeEach(() => {
        useRegistry({ services: {} })
        vi.mocked(compileService).mockResolvedValue({ toolNames: ['shopify'], oauth: null, managed: null, composio: null, app: null })
    })

    afterEach(() => {
        vi.mocked(compileService).mockResolvedValue({ toolNames: [], oauth: null, managed: null, composio: { toolkit: 'gmail', serverName: 'gmail' }, app: null })
        vi.mocked(supportsVault).mockResolvedValue(false)
    })

    it.each([
        ['on the coworker', false],
        ['in the Vault', true],
    ])('refuses an app not installed on the store and saves nothing %s', async (_, vault) => {
        vi.mocked(supportsVault).mockResolvedValue(vault)
        vi.mocked(fetchPublic).mockResolvedValue(new Response('Oauth error app_not_installed: The application is not installed on this shop.', { status: 400 }))

        await expect(installService('agent', 'shopify', CREDENTIALS, 'client_credentials')).rejects.toMatchObject({ code: 'shopifyAppNotInstalled', params: { domain: 'walking-store.myshopify.com' } })
        expect(vi.mocked(fetchPublic).mock.calls[0][0]).toBe('https://walking-store.myshopify.com/admin/oauth/access_token')
        expect(compileService).not.toHaveBeenCalled()
        expect(compileIntoVault).not.toHaveBeenCalled()
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })

    it('installs credentials Shopify exchanges for a token', async () => {
        vi.mocked(fetchPublic).mockResolvedValue(new Response(JSON.stringify({ access_token: 'shpat_x' }), { status: 200 }))

        await expect(installService('agent', 'shopify', CREDENTIALS, 'client_credentials')).resolves.toMatchObject({ status: 'installed', key: 'shopify' })
    })

    it('saves the store domain the way it was checked', async () => {
        vi.mocked(fetchPublic).mockResolvedValue(new Response(JSON.stringify({ access_token: 'shpat_x' }), { status: 200 }))

        await installService('agent', 'shopify', { ...CREDENTIALS, MYSHOPIFY_DOMAIN: ' https://Walking-Store.myshopify.com/ ' }, 'client_credentials')

        expect(vi.mocked(compileService).mock.calls[0][2]).toEqual(CREDENTIALS)
    })

    it('asks Shopify nothing for an access token', async () => {
        await expect(installService('agent', 'shopify', { SHOPIFY_ACCESS_TOKEN: 'shpat_x', MYSHOPIFY_DOMAIN: 'walking-store.myshopify.com' }, 'default')).resolves.toMatchObject({ status: 'installed' })
        expect(fetchPublic).not.toHaveBeenCalled()
    })
})

describe('getServiceDetails', () => {
    it('describes the addressed account and lists every account of the app', async () => {
        useRegistry({ services: { 'gmail@k3x9ab': entry({ status: 'needs_auth', label: 'Gmail 2', installedAt: '2026-10-02' }), gmail: entry() } })
        const details = await getServiceDetails('agent', 'gmail@k3x9ab')

        expect(details).toMatchObject({ key: 'gmail@k3x9ab', slug: 'gmail', label: 'Gmail 2', installStatus: 'needs_auth', multiInstance: true })
        expect(details.instances).toEqual([
            { key: 'gmail', status: 'active' },
            { key: 'gmail@k3x9ab', status: 'needs_auth', label: 'Gmail 2' },
        ])
    })
})

describe('installedFromRegistry', () => {
    it('lists one row per account, the base one first', async () => {
        const rows = await installedFromRegistry({ services: { 'gmail@k3x9ab': entry({ label: 'Gmail 2', installedAt: '2026-10-02' }), notion: entry(), gmail: entry() } })

        expect(rows.map(r => [r.key, r.slug, r.label])).toEqual([
            ['gmail', 'gmail', undefined],
            ['gmail@k3x9ab', 'gmail', 'Gmail 2'],
            ['notion', 'notion', undefined],
        ])
        expect(rows[1].instanceId).toBe('k3x9ab')
    })
})

describe('searchServices', () => {
    it('shows an app installed while only an extra account is left', async () => {
        useRegistry({ services: { 'gmail@k3x9ab': entry() } })
        const { results } = await searchServices('agent')

        expect(results.find(r => r.slug === 'gmail')).toMatchObject({ installStatus: 'active', installed: true, multiInstance: true })
    })

    it.each(['base', 'lifetime'])('lists the paid apps for a workspace on the %s plan', async plan => {
        useRegistry({ services: {} })
        workspacePlan = plan
        const { results } = await searchServices('agent')

        expect(results.map(r => r.slug)).toContain('whatsapp-pro')
    })

    it('leaves the paid apps out for an AppSumo workspace, which is not sold them', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime_restricted'
        const { results } = await searchServices('agent')

        expect(results.map(r => r.slug)).toEqual(['gmail', 'notion'])
    })
})

describe('installService on a lifetime workspace', () => {
    it('refuses a paid app on the AppSumo plan', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime_restricted'

        await expect(installService('agent', 'whatsapp-pro')).rejects.toThrow('WhatsApp Pro is not included in the lifetime plan.')
        expect(compileService).not.toHaveBeenCalled()
    })

    it('installs a paid app on the full lifetime plan, which buys its slots', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime'

        await expect(installService('agent', 'whatsapp-pro')).resolves.toMatchObject({ slug: 'whatsapp-pro' })
    })

    it('still installs any other service', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime_restricted'

        await expect(installService('agent', 'gmail')).resolves.toMatchObject({ slug: 'gmail' })
    })
})

// The account a paid app acts with is bound to a coworker's row, which the Chief of Staff does not have.
describe('the paid apps and the Chief of Staff', () => {
    const ACTOR = { kind: 'workspace', workspaceId: 7 } as const

    it('lists them in its catalog on a plan that sells them', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'base'
        const { results } = await searchServices('foreman', undefined, undefined, ACTOR)

        expect(results.map(r => r.slug)).toEqual(['gmail', 'notion', 'whatsapp-pro'])
    })

    it('leaves them out on a plan that does not', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'lifetime_restricted'
        const { results } = await searchServices('foreman', undefined, undefined, ACTOR)

        expect(results.map(r => r.slug)).toEqual(['gmail', 'notion'])
    })

    it('installs one on it, bound to its row', async () => {
        useRegistry({ services: {} })
        workspacePlan = 'base'
        vi.mocked(compileService).mockResolvedValueOnce({ toolNames: [], oauth: null, managed: null, composio: null, app: { appSlug: 'whatsapp', serverName: 'whatsapp_pro' } } as never)

        await expect(installService('foreman', 'whatsapp-pro', {}, undefined, ACTOR)).resolves.toMatchObject({ status: 'needs_auth', slug: 'whatsapp-pro' })
        expect(vi.mocked(syncAppConnector).mock.calls.at(-1)?.slice(1)).toEqual(['foreman-row', 'whatsapp'])
    })
})

describe('uninstallService', () => {
    it('leaves the skills another account still lists and removes only its own entry', async () => {
        useRegistry({ services: { gmail: entry({ skills: ['gmail-usage'] }), 'gmail@k3x9ab': entry({ skills: ['gmail-usage'] }) } })
        await uninstallService('agent', 'gmail@k3x9ab')

        expect(vi.mocked(decompileService).mock.calls[0][3]).toEqual({ keepSkills: new Set(['gmail-usage']) })
        expect(vi.mocked(removeRegistryEntry)).toHaveBeenCalledWith({}, 'engine-agent', 'gmail@k3x9ab')
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })
})

describe('resetServiceConnection', () => {
    const app = { appSlug: 'whatsapp', serverName: 'whatsapp_pro' }

    it('keeps a paid app as it is while its coworker still holds accounts, its connector brought in line with them', async () => {
        useRegistry({ services: { 'whatsapp-pro': entry({ status: 'needs_auth', app }) } })
        vi.mocked(syncAppConnector).mockResolvedValue(2)

        await expect(resetServiceConnection('agent', 'whatsapp-pro')).resolves.toEqual({ mode: 'auth', app })
        expect(vi.mocked(syncAppConnector).mock.calls.at(-1)?.slice(1)).toEqual(['agent', 'whatsapp'])
        expect(upsertRegistryEntry).not.toHaveBeenCalled()
    })

    it('sends a coworker with no account back to the picker', async () => {
        useRegistry({ services: { 'whatsapp-pro': entry({ status: 'active', app: { ...app, accountLabel: 'Shop' } }) } })
        vi.mocked(syncAppConnector).mockResolvedValue(0)

        await expect(resetServiceConnection('agent', 'whatsapp-pro')).resolves.toEqual({ mode: 'auth', app })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3]).toMatchObject({ status: 'needs_auth', app })
        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3].app).not.toHaveProperty('accountLabel')
    })
})

// A member who only uses the Box still sees the coworker's apps, and changes none of them.
describe('access level', () => {
    const MEMBER = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' } as const

    beforeEach(() => {
        vi.mocked(resolveAgentTarget).mockClear()
        useRegistry({ services: { gmail: entry() } })
    })

    it('reads the installed apps at use', async () => {
        await listInstalledServices('agent', MEMBER)
        await searchServices('agent', undefined, undefined, MEMBER)
        await getServiceDetails('agent', 'gmail', MEMBER).catch(() => null)

        for (const call of vi.mocked(resolveAgentTarget).mock.calls) expect(call).toEqual(['agent', 'use', MEMBER])
    })

    it('asks manage to install, reset, authorize or uninstall', async () => {
        await uninstallService('agent', 'gmail', MEMBER)
        await resetServiceConnection('agent', 'gmail', MEMBER)
        await markServiceAuthorized('agent', 'gmail', MEMBER)

        expect(vi.mocked(resolveAgentTarget).mock.calls).toEqual([
            ['agent', 'manage', MEMBER],
            ['agent', 'manage', MEMBER],
            ['agent', 'manage', MEMBER],
        ])
    })

    it('runs a hub call from the engine as the workspace itself', async () => {
        await dispatchHubTool('agent', 'service_list_installed', {}, 7)

        expect(resolveAgentTarget).toHaveBeenCalledWith('agent', 'use', { kind: 'workspace', workspaceId: 7 })
    })
})

describe('search_docs', () => {
    it('answers a coworker out of the Rerun documentation', async () => {
        const answer = { documentation: 'https://docs.rerun.build', passages: [{ title: 'Triggers', url: 'https://docs.rerun.build/agents/triggers', text: 'A webhook trigger…' }] }
        vi.mocked(searchDocs).mockResolvedValue(answer)

        await expect(dispatchHubTool('agent', 'search_docs', { query: 'webhook trigger' }, 7)).resolves.toEqual(answer)
        expect(searchDocs).toHaveBeenCalledWith('webhook trigger')
        expect(resolveAgentTarget).not.toHaveBeenCalled()
    })

    it('refuses a search without a query', async () => {
        await expect(dispatchHubTool('agent', 'search_docs', {}, 7)).rejects.toThrow('query')
        expect(searchDocs).not.toHaveBeenCalled()
    })
})
