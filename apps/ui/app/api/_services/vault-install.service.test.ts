import { paidAppFlags } from '@rerun/cloud/apps.server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EngineRequestError } from '@/lib/engine/client'
import { createVaultItem, getVaultItem, listVaultItems, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { fetchPublic } from '@/lib/net/public-fetch'
import { addVaultMcp, addVaultSecret, addVaultService, reconfigureVaultService, saveSecretsToVault, vaultCatalog, vaultServerName } from './vault-install.service'
import { loadManifest, toAuthMethodSummaries } from './services.service'
import { assertManagesCoworker, shareVaultEntry } from './vault.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectAll: vi.fn(), selectMany: vi.fn() }))
vi.mock('@rerun/cloud/apps.server', () => ({ paidAppFlags: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ createVaultItem: vi.fn(async (_c: unknown, input: Record<string, unknown>) => ({ id: 'new', ...input })), attachVaultItem: vi.fn(), getVaultItem: vi.fn(), listVaultItems: vi.fn(), updateVaultItemEnv: vi.fn() }))
vi.mock('./services.service', () => ({ loadManifest: vi.fn(), toAuthMethodSummaries: vi.fn() }))
vi.mock('@/lib/net/public-fetch', () => ({ fetchPublic: vi.fn() }))
vi.mock('./vault.service', async () => ({
    rethrowConflict: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).rethrowConflict,
    requireAdmin: (await vi.importActual<typeof import('./vault.service')>('./vault.service')).requireAdmin,
    vaultContext: vi.fn(async (actor?: unknown) => ({ actor: actor ?? { kind: 'user', userId: 'user-1', workspaceId: 7 }, conn: {}, coworkers: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box' }], byEngineId: new Map() })),
    assertCanAdd: vi.fn(async () => {}),
    assertCanChangeItem: vi.fn(async () => {}),
    assertManagesCoworker: vi.fn(async (_actor: unknown, coworker: unknown) => coworker),
    shareVaultEntry: vi.fn(async (id: string) => ({ id, sharedWithAll: true })),
}))

beforeEach(() => vi.clearAllMocks())

const MCP_HEADERS = { 'x-rerun-key': '${RERUN_API_KEY}', 'x-rerun-agent': '${agent.id}' }

const WHATSAPP_PRO = {
    slug: 'whatsapp-pro',
    name: 'WhatsApp Pro',
    icon: null,
    category: 'crm',
    summary: 'Read and answer WhatsApp conversations',
    manifest: {
        slug: 'whatsapp-pro',
        name: 'WhatsApp Pro',
        summary: 'Read and answer WhatsApp conversations',
        category: 'crm',
        authMethods: [
            {
                id: 'app',
                kind: 'app',
                label: 'Pick a WhatsApp number',
                recommended: true,
                inputs: [],
                envKeys: [],
                app: { appSlug: 'whatsapp' },
                mcpServers: [{ name: 'whatsapp_pro', transport: 'http', url: '${RERUN_HUB_BASE_URL}/api/mcp/apps/whatsapp', headers: MCP_HEADERS, args: [], env: {} }],
            },
        ],
    },
}

const GMAIL = {
    slug: 'gmail',
    name: 'Gmail',
    icon: null,
    category: 'productivity',
    summary: 'Read and send email',
    manifest: {
        slug: 'gmail',
        name: 'Gmail',
        summary: 'Read and send email',
        category: 'productivity',
        authMethods: [
            {
                id: 'composio',
                kind: 'composio',
                label: 'Connect with Google',
                recommended: true,
                inputs: [],
                envKeys: [],
                composio: { toolkit: 'gmail', allowedTools: [], authConfigId: 'ac_1' },
                mcpServers: [{ name: 'gmail', transport: 'http', url: '${RERUN_HUB_BASE_URL}/api/mcp/composio/gmail', headers: MCP_HEADERS, args: [], env: {} }],
            },
        ],
    },
}

// The catalog, and the paid apps' own rows the Vault reads beside it when nothing is searched.
function catalogRows(catalog: unknown[]) {
    vi.mocked(selectAll).mockResolvedValue({ data: catalog, error: null } as never)
    vi.mocked(selectMany).mockImplementation((async (_client: unknown, _table: unknown, _columns: unknown, filters: { slug?: string[] }) => ({
        data: [WHATSAPP_PRO].filter(row => filters.slug?.includes(row.slug)),
        error: null,
    })) as never)
}

function keyApp(slug: string, name: string) {
    return {
        slug,
        name,
        icon: null,
        category: 'productivity',
        summary: name,
        manifest: { slug, name, summary: name, category: 'productivity', inputs: [{ key: `${slug.toUpperCase().replace(/-/g, '_')}_KEY`, label: 'API key', type: 'password', secret: true, required: true }] },
    }
}

const LONG_CATALOG = [...Array.from({ length: 70 }, (_, i) => keyApp(`app-${i + 1}`, `App ${String(i + 1).padStart(3, '0')}`)), keyApp('zapier', 'Zapier')]

describe('vaultCatalog', () => {
    beforeEach(() => {
        catalogRows([WHATSAPP_PRO, GMAIL])
        vi.mocked(toAuthMethodSummaries).mockImplementation(manifest => manifest.authMethods.map(method => ({ id: method.id, label: method.label, kind: method.kind, recommended: method.recommended, inputs: method.inputs, requiresSecrets: false })))
    })

    it('offers a paid app the plan sells, to be connected in its own window', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({ linkedin: true, whatsapp: true })
        catalogRows([WHATSAPP_PRO])
        const apps = await vaultCatalog('whatsapp')
        expect(apps).toEqual([expect.objectContaining({ slug: 'whatsapp-pro', paidApp: 'whatsapp', authMethods: [] })])
    })

    it('leaves a paid app out where the plan does not sell it', async () => {
        catalogRows([WHATSAPP_PRO])
        vi.mocked(paidAppFlags).mockResolvedValue({})
        expect(await vaultCatalog('whatsapp')).toEqual([])
        expect(await vaultCatalog()).toEqual([])
    })

    it('offers an app that signs in through Composio, browsed or searched', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({ linkedin: true, whatsapp: true })
        const gmail = expect.objectContaining({ slug: 'gmail', authMethods: [expect.objectContaining({ kind: 'composio' })] })
        expect(await vaultCatalog()).toContainEqual(gmail)
        expect(await vaultCatalog('gmail')).toContainEqual(gmail)
    })

    it('puts the paid apps first when nothing is searched, even past the first page by name', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({ linkedin: true, whatsapp: true })
        catalogRows([])
        expect((await vaultCatalog()).map(app => app.slug)).toEqual(['whatsapp-pro'])
    })

    it('lists a paid app once when the first page holds it too', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({ linkedin: true, whatsapp: true })
        expect((await vaultCatalog()).filter(app => app.slug === 'whatsapp-pro')).toHaveLength(1)
    })

    it('offers every app of a long catalog when browsed, down to the end of the alphabet', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({})
        catalogRows(LONG_CATALOG)
        const slugs = (await vaultCatalog()).map(app => app.slug)
        expect(slugs).toHaveLength(LONG_CATALOG.length)
        expect(slugs).toContain('zapier')
    })

    it('returns every match of a broad search', async () => {
        vi.mocked(paidAppFlags).mockResolvedValue({})
        catalogRows(LONG_CATALOG.filter(row => row.name.toLowerCase().includes('a')))
        expect((await vaultCatalog('a')).map(app => app.slug)).toContain('zapier')
    })
})

const GETXAPI = serviceManifestSchema.parse({
    slug: 'getxapi',
    name: 'GetXAPI',
    inputs: [{ key: 'GETXAPI_KEY', label: 'GetXAPI API key', type: 'password', secret: true, required: true }],
    mcpServers: [{ name: 'getxapi', transport: 'stdio', command: 'npx', args: ['-y', '@getxapi/mcp@latest'], env: { GETXAPI_KEY: '${input.GETXAPI_KEY}' } }],
})

describe('addVaultService', () => {
    beforeEach(() => {
        vi.mocked(loadManifest).mockResolvedValue(GETXAPI)
        vi.mocked(toAuthMethodSummaries).mockReturnValue([])
    })

    it('gives the second account of any app its own server and variables, so both fit on one coworker', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([{ id: 'first', slug: 'getxapi' }] as never)
        await addVaultService({ slug: 'getxapi', values: { GETXAPI_KEY: 'key-2' } })

        const input = vi.mocked(createVaultItem).mock.calls[0][1]
        const instanceId = input.instanceId as string
        expect(instanceId).toMatch(/^[a-z0-9]{6}$/)
        expect(input).toMatchObject({ slug: 'getxapi', label: 'GetXAPI 2' })
        expect(input.mcpServers?.map(server => server.name)).toEqual([`getxapi-${instanceId}`])
        expect(input.env).toEqual({ [`RERUN_SVC_GETXAPI_${instanceId.toUpperCase()}_GETXAPI_KEY`]: 'key-2' })
    })

    it('keeps the plain names for the first account', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([])
        await addVaultService({ slug: 'getxapi', values: { GETXAPI_KEY: 'key-1' } })

        const input = vi.mocked(createVaultItem).mock.calls[0][1]
        expect(input).not.toHaveProperty('instanceId')
        expect(input.mcpServers?.map(server => server.name)).toEqual(['getxapi'])
        expect(input.env).toEqual({ RERUN_SVC_GETXAPI_GETXAPI_KEY: 'key-1' })
    })
})

describe('addVaultService, for an app that signs in through Composio', () => {
    const gmail = serviceManifestSchema.parse(GMAIL.manifest)

    beforeEach(() => {
        vi.stubEnv('COMPOSIO_API_KEY', 'key')
        vi.mocked(loadManifest).mockResolvedValue(gmail)
        vi.mocked(toAuthMethodSummaries).mockReturnValue([])
        vi.mocked(listVaultItems).mockResolvedValue([])
    })

    afterEach(() => vi.unstubAllEnvs())

    it('waits on its sign-in, with no coworker, the first account and the next ones', async () => {
        expect(await addVaultService({ slug: 'gmail' })).toMatchObject({ status: 'needs_auth', composio: { toolkit: 'gmail', serverName: 'gmail' } })
        expect(vi.mocked(createVaultItem).mock.calls[0][1]).toMatchObject({ status: 'needs_auth', agentIds: [] })

        vi.mocked(listVaultItems).mockResolvedValue([{ id: 'first', slug: 'gmail' }] as never)
        const second = await addVaultService({ slug: 'gmail' })
        const { instanceId, label } = vi.mocked(createVaultItem).mock.calls[1][1]
        expect(label).toBe('Gmail 2')
        expect(second).toMatchObject({ status: 'needs_auth', composio: { toolkit: 'gmail', serverName: `gmail-${instanceId}` } })
    })

    it('makes no entry on an install that cannot sign in to it', async () => {
        vi.stubEnv('COMPOSIO_API_KEY', '')
        await expect(addVaultService({ slug: 'gmail' })).rejects.toMatchObject({ code: 'composioNotConfigured' })
        expect(createVaultItem).not.toHaveBeenCalled()
    })
})

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

    it("keeps a command's environment secrets in the entry's variables too", async () => {
        await addVaultMcp({ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_secret' }] })
        const input = vi.mocked(createVaultItem).mock.calls[0][1]
        expect(input.env).toEqual({ VAULT_GITHUB_GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' })
        expect(input.mcpServers).toEqual([
            { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], headers: {}, env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${VAULT_GITHUB_GITHUB_PERSONAL_ACCESS_TOKEN}' } },
        ])
        expect(JSON.stringify(input.mcpServers)).not.toContain('ghp_secret')
    })

    it('keeps a transport the pasted config declared', async () => {
        await addVaultMcp({ name: 'sentry', url: 'https://mcp.sentry.dev/events', transport: 'sse' })
        expect(vi.mocked(createVaultItem).mock.calls[0][1].mcpServers).toEqual([{ name: 'sentry', url: 'https://mcp.sentry.dev/events', transport: 'sse', headers: {} }])
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

// RER-317: the Vault's own form saved Shopify without asking the store, so an app not installed on it showed as connected.
describe('Shopify with a Client ID and secret, from the Vault', () => {
    const SHOPIFY = serviceManifestSchema.parse({
        slug: 'shopify',
        name: 'Shopify',
        authMethods: [
            {
                id: 'client_credentials',
                label: 'Client ID and secret',
                kind: 'stdio',
                inputs: [
                    { key: 'SHOPIFY_CLIENT_ID', type: 'text', label: 'Client ID', required: true },
                    { key: 'SHOPIFY_CLIENT_SECRET', type: 'password', label: 'Client secret', secret: true, required: true },
                    { key: 'MYSHOPIFY_DOMAIN', type: 'text', label: 'Store domain', required: true },
                ],
                mcpServers: [{ name: 'shopify', command: 'npx', args: ['-y', 'cob-shopify-mcp', 'start'], env: { SHOPIFY_CLIENT_ID: '${input.SHOPIFY_CLIENT_ID}', SHOPIFY_CLIENT_SECRET: '${input.SHOPIFY_CLIENT_SECRET}', SHOPIFY_STORE_DOMAIN: '${input.MYSHOPIFY_DOMAIN}' } }],
            },
        ],
    })
    const CREDENTIALS = { SHOPIFY_CLIENT_ID: 'client-id', SHOPIFY_CLIENT_SECRET: 'shpss_secret', MYSHOPIFY_DOMAIN: 'https://Walking-Store.myshopify.com/' }
    const notInstalled = () => vi.mocked(fetchPublic).mockResolvedValue(new Response('Oauth error app_not_installed: The application is not installed on this shop.', { status: 400 }))

    beforeEach(() => {
        vi.mocked(loadManifest).mockResolvedValue(SHOPIFY)
        vi.mocked(toAuthMethodSummaries).mockReturnValue([])
        vi.mocked(listVaultItems).mockResolvedValue([])
    })

    it('refuses an app not installed on the store and adds nothing', async () => {
        notInstalled()

        await expect(addVaultService({ slug: 'shopify', values: CREDENTIALS, authMethodId: 'client_credentials', agentIds: ['alice'] })).rejects.toMatchObject({ code: 'shopifyAppNotInstalled', params: { domain: 'walking-store.myshopify.com' } })
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('refuses it when the entry is configured again, and leaves the entry as it was', async () => {
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'shop', kind: 'service', slug: 'shopify', authMethodId: 'client_credentials' } as never)
        notInstalled()

        await expect(reconfigureVaultService('shop', CREDENTIALS, 'client_credentials')).rejects.toMatchObject({ code: 'shopifyAppNotInstalled' })
        expect(updateVaultItemEnv).not.toHaveBeenCalled()
    })

    it('saves the store domain the way it was checked', async () => {
        vi.mocked(fetchPublic).mockResolvedValue(new Response(JSON.stringify({ access_token: 'shpat_x' }), { status: 200 }))

        await addVaultService({ slug: 'shopify', values: CREDENTIALS, authMethodId: 'client_credentials' })

        expect(vi.mocked(createVaultItem).mock.calls[0][1].config).toMatchObject({ MYSHOPIFY_DOMAIN: 'walking-store.myshopify.com' })
    })
})

describe('saveSecretsToVault', () => {
    const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'admin', boxScope: 'all' } as const

    it('keeps every key of the form in one new secret, lent to the coworkers named', async () => {
        await saveSecretsToVault({ name: 'OpenAI key', agentIds: ['alice'] }, { OPENAI_API_KEY: 'sk-1' }, ACTOR)
        expect(createVaultItem).toHaveBeenCalledWith({}, expect.objectContaining({ kind: 'secret', name: 'OpenAI key', env: { OPENAI_API_KEY: 'sk-1' }, agentIds: ['e-alice'] }))
        expect(shareVaultEntry).not.toHaveBeenCalled()
    })

    it('gives it to every coworker when asked', async () => {
        await saveSecretsToVault({ name: 'OpenAI key', sharedWithAll: true }, { OPENAI_API_KEY: 'sk-1' }, ACTOR)
        expect(createVaultItem).toHaveBeenCalledWith({}, expect.objectContaining({ kind: 'secret', sharedWithAll: true }))
        expect(shareVaultEntry).not.toHaveBeenCalled()
    })

    it('refuses a share with every coworker to a member before writing anything', async () => {
        const member = { ...ACTOR, role: 'member' } as const
        await expect(saveSecretsToVault({ name: 'OpenAI key', sharedWithAll: true }, { OPENAI_API_KEY: 'sk-1' }, member)).rejects.toThrow('Only an admin')
        expect(createVaultItem).not.toHaveBeenCalled()
        expect(shareVaultEntry).not.toHaveBeenCalled()
    })

    it('refuses it to a member for an MCP server too, whoever calls', async () => {
        const member = { ...ACTOR, role: 'member' } as const
        await expect(addVaultMcp({ name: 'Docs', url: 'https://docs.acme.test/mcp', sharedWithAll: true }, member)).rejects.toThrow('Only an admin')
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('writes nothing more when the names clash with an entry every coworker gets', async () => {
        vi.mocked(createVaultItem).mockRejectedValueOnce(new EngineRequestError(`rerun-engine POST /vault failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: '*', itemId: 'item-1', kind: 'env', name: 'OPENAI_API_KEY' }] })}`, 409))
        await expect(saveSecretsToVault({ name: 'OpenAI key', sharedWithAll: true }, { OPENAI_API_KEY: 'sk-1' }, ACTOR)).rejects.toThrow('Every coworker already gets')
        expect(createVaultItem).toHaveBeenCalledTimes(1)
        expect(shareVaultEntry).not.toHaveBeenCalled()
    })

    it('refuses a server whose header has no value, or a value no header reads, before writing anything', async () => {
        const target = { name: 'Docs', mcpServer: { url: 'https://docs.acme.test/mcp', headers: [{ header: 'Authorization', key: 'DOCS_TOKEN' }] } }
        await expect(saveSecretsToVault(target, { OTHER_KEY: 'x' }, ACTOR)).rejects.toThrow('every key')
        await expect(saveSecretsToVault(target, { DOCS_TOKEN: 't', OTHER_KEY: 'x' }, ACTOR)).rejects.toThrow('every key')
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('puts the prefix of a header before the value typed', async () => {
        await saveSecretsToVault({ name: 'Docs', mcpServer: { url: 'https://docs.acme.test/mcp', headers: [{ header: 'Authorization', key: 'DOCS_TOKEN', prefix: 'Bearer' }] } }, { DOCS_TOKEN: 't' }, ACTOR)
        const input = vi.mocked(createVaultItem).mock.calls[0][1] as { env: Record<string, string> }
        expect(Object.values(input.env)).toEqual(['Bearer t'])
    })

    it('makes a custom MCP server whose headers the form fills', async () => {
        await saveSecretsToVault({ name: 'Docs', mcpServer: { url: 'https://docs.acme.test/mcp', headers: [{ header: 'Authorization', key: 'DOCS_TOKEN' }] } }, { DOCS_TOKEN: 'Bearer t' }, ACTOR)
        const input = vi.mocked(createVaultItem).mock.calls[0][1] as { kind: string; env: Record<string, string>; mcpServers: { headers: Record<string, string> }[] }
        expect(input.kind).toBe('mcp')
        expect(Object.values(input.env)).toEqual(['Bearer t'])
        expect(input.mcpServers[0].headers.Authorization).toMatch(/^\$\{VAULT_DOCS_AUTHORIZATION\}$/)
    })

    it('replaces the one key of an entry, whatever the form named it', async () => {
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-openai', kind: 'secret', envKeys: ['OPENAI_KEY'] } as never)
        await saveSecretsToVault({ entryId: 'item-openai' }, { OPENAI_API_KEY: 'sk-2' }, ACTOR)
        expect(updateVaultItemEnv).toHaveBeenCalledWith({}, 'item-openai', { set: { OPENAI_KEY: 'sk-2' } })
    })

    it('refuses keys an entry of several does not hold, and the key of an app', async () => {
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-two', kind: 'secret', envKeys: ['A_KEY', 'B_KEY'] } as never)
        await expect(saveSecretsToVault({ entryId: 'item-two' }, { C_KEY: 'x' }, ACTOR)).rejects.toThrow('other keys')
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-app', kind: 'service', envKeys: ['NOTION_TOKEN'] } as never)
        await expect(saveSecretsToVault({ entryId: 'item-app' }, { NOTION_TOKEN: 'x' }, ACTOR)).rejects.toThrow('other keys')
        expect(updateVaultItemEnv).not.toHaveBeenCalled()
    })
})
