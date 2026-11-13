import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readFileText, supportsVault, writeFileText } from '@/lib/engine/client'
import { detachVaultItem, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { type RegistryEntry, readRegistry, removeRegistryEntry, upsertRegistryEntry } from '@/lib/services/registry'

vi.mock('@/lib/engine/client', () => ({ makeDir: vi.fn(async () => {}), readFileText: vi.fn(), writeFileText: vi.fn(), supportsVault: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ listVaultItems: vi.fn(), patchVaultItem: vi.fn(), detachVaultItem: vi.fn() }))

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const own = (status: RegistryEntry['status'] = 'active'): RegistryEntry => ({ status, config: {}, mcpServers: ['notion'], envKeys: ['NOTION_KEY'], skills: [], installedAt: '2026-10-01' })

const item = (over: Record<string, unknown> = {}) => ({
    id: 'item-gmail',
    kind: 'service',
    slug: 'gmail',
    name: 'Gmail',
    label: 'ops@acme.test',
    status: 'active',
    authMethodId: 'oauth',
    config: { region: 'eu' },
    mcpServers: [{ name: 'gmail', args: [], env: {}, headers: {} }],
    skills: [{ slug: 'gmail-howto', name: 'Gmail how-to', description: '', body: 'b' }],
    oauth: { serverName: 'gmail', url: 'https://gmail.test/mcp' },
    agentIds: ['engine-agent'],
    sharedWithAll: false,
    createdBy: null,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    envKeys: ['GMAIL_KEY'],
    tokens: ['gmail'],
    ...over,
})

function ownRegistry(services: Record<string, RegistryEntry>) {
    vi.mocked(readFileText).mockResolvedValue({ content: JSON.stringify({ services }) } as never)
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supportsVault).mockResolvedValue(true)
    vi.mocked(listVaultItems).mockResolvedValue([item()] as never)
    ownRegistry({ notion: own() })
})

describe('the registry of a coworker on a box that keeps a Vault', () => {
    it("lists its own connectors and the Vault's catalog apps attached to it, in one shape", async () => {
        const reg = await readRegistry(conn, 'engine-agent')
        expect(Object.keys(reg.services).sort()).toEqual(['gmail', 'notion'])
        expect(reg.services.gmail).toEqual({
            status: 'active',
            config: { region: 'eu' },
            authMethodId: 'oauth',
            mcpServers: ['gmail'],
            envKeys: ['GMAIL_KEY'],
            skills: ['gmail-howto'],
            oauth: { serverName: 'gmail', url: 'https://gmail.test/mcp' },
            label: 'ops@acme.test',
            installedAt: '2026-11-13T00:00:00.000Z',
            vaultItemId: 'item-gmail',
        })
        expect(listVaultItems).toHaveBeenCalledWith(conn, 'engine-agent')
    })

    it('keys an extra account of an app by its instance, and leaves custom servers and secrets out', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([item({ id: 'second', instanceId: 'k3x9ab' }), item({ id: 'secret', kind: 'secret', slug: null }), item({ id: 'mcp', kind: 'mcp', slug: null })] as never)
        const reg = await readRegistry(conn, 'engine-agent')
        expect(Object.keys(reg.services).sort()).toEqual(['gmail@k3x9ab', 'notion'])
        expect(reg.services['gmail@k3x9ab'].instanceId).toBe('k3x9ab')
    })

    it("puts the Vault's entry in place of the coworker's own copy under the same key", async () => {
        ownRegistry({ gmail: { ...own('needs_auth'), mcpServers: ['gmail'] } })
        expect((await readRegistry(conn, 'engine-agent')).services.gmail.vaultItemId).toBe('item-gmail')
    })

    it('writes a change to an entry the Vault lends to the item, never to services.json', async () => {
        const reg = await readRegistry(conn, 'engine-agent')
        await upsertRegistryEntry(conn, 'engine-agent', 'gmail', { ...reg.services.gmail, status: 'needs_auth', label: 'support@acme.test' })
        expect(patchVaultItem).toHaveBeenCalledWith(conn, 'item-gmail', {
            status: 'needs_auth',
            config: { region: 'eu' },
            authMethodId: 'oauth',
            label: 'support@acme.test',
            oauth: { serverName: 'gmail', url: 'https://gmail.test/mcp' },
            managed: null,
            composio: null,
            app: null,
        })
        expect(writeFileText).not.toHaveBeenCalled()
    })

    it("writes the coworker's own entries to its own file, without the Vault's", async () => {
        await upsertRegistryEntry(conn, 'engine-agent', 'notion', own('needs_auth'))
        const written = JSON.parse(vi.mocked(writeFileText).mock.calls[0][3] as string)
        expect(Object.keys(written.services)).toEqual(['notion'])
        expect(written.services.notion.status).toBe('needs_auth')
        expect(patchVaultItem).not.toHaveBeenCalled()
    })

    it('detaches the coworker when it removes an entry the Vault lends, and drops its own copy', async () => {
        ownRegistry({ gmail: own(), notion: own() })
        await removeRegistryEntry(conn, 'engine-agent', 'gmail')
        expect(detachVaultItem).toHaveBeenCalledWith(conn, 'item-gmail', 'engine-agent')
        expect(Object.keys(JSON.parse(vi.mocked(writeFileText).mock.calls[0][3] as string).services)).toEqual(['notion'])
    })

    it('reads an unreachable Vault as empty, like an unreachable registry', async () => {
        vi.mocked(listVaultItems).mockRejectedValue(new Error('down'))
        expect(Object.keys((await readRegistry(conn, 'engine-agent')).services)).toEqual(['notion'])
    })

    it('fails a write rather than sending it to the coworker file while the Vault cannot be read', async () => {
        vi.mocked(listVaultItems).mockRejectedValue(new Error('down'))
        await expect(upsertRegistryEntry(conn, 'engine-agent', 'gmail', own())).rejects.toThrow('down')
        await expect(removeRegistryEntry(conn, 'engine-agent', 'gmail')).rejects.toThrow('down')
        expect(writeFileText).not.toHaveBeenCalled()
    })
})

describe('the registry of a coworker on a box without a Vault', () => {
    it('reads and writes services.json only, never asking for a Vault', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        expect(Object.keys((await readRegistry(conn, 'engine-agent')).services)).toEqual(['notion'])
        await upsertRegistryEntry(conn, 'engine-agent', 'gmail', own())
        await removeRegistryEntry(conn, 'engine-agent', 'notion')
        expect(listVaultItems).not.toHaveBeenCalled()
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(detachVaultItem).not.toHaveBeenCalled()
        expect(writeFileText).toHaveBeenCalledTimes(2)
    })
})
