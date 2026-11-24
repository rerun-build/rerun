import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assertAgentAccess } from '@/app/api/_auth/access'
import { assertCanAdd, readItem } from '@/app/api/_services/vault.service'
import { AppError } from '@/lib/i18n/action-error'
import { loadManifest } from '@/app/api/_services/services.service'
import { composioUserId, composioVaultOwnUserId, initiateConnectedAccount } from '@/lib/composio/client'
import { decodeComposioContext } from '@/lib/composio/oauth'
import { getVaultItem } from '@/lib/engine/vault-client'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { readRegistry, type RegistryEntry, type ServiceRegistry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { POST } from './route'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: vi.fn(async () => ({ actor: { kind: 'workspace', workspaceId: 7 } })) }))
vi.mock('@/app/api/_services/services.service', () => ({ loadManifest: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/registry', () => ({
    readRegistry: vi.fn(),
    resolveRegistryEntry: (registry: ServiceRegistry, key: string) => (registry.services[key] ? { key, entry: registry.services[key] } : null),
}))
vi.mock('@/app/api/_services/vault.service', () => ({ vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 } })), assertCanAdd: vi.fn(), readItem: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), composioConfigured: () => true, initiateConnectedAccount: vi.fn() }))

const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_COWORKER = '99999999-9999-4999-8999-999999999999'

const MANIFEST = serviceManifestSchema.parse({
    slug: 'gmail',
    name: 'Gmail',
    authMethods: [{ id: 'composio', kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_gmail' }, mcpServers: [{ name: 'gmail', transport: 'http', url: 'https://rerun.test/api/mcp/composio/gmail' }] }],
})

const entry: RegistryEntry = { status: 'needs_auth', config: {}, mcpServers: ['gmail'], envKeys: [], skills: [], installedAt: '', composio: { toolkit: 'gmail', serverName: 'gmail' } }

const start = (body: object = { agentId: AGENT_ID, key: 'gmail' }) => POST(new Request('https://rerun.test/api/oauth/composio/start', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
    vi.mocked(loadManifest).mockResolvedValue(MANIFEST)
    vi.mocked(initiateConnectedAccount).mockResolvedValue({ connectedAccountId: 'ca_1', redirectUrl: 'https://connect.composio.dev/link/x' })
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/oauth/composio/start', () => {
    it("connects a coworker's own account as that coworker's Composio user", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: entry } })

        const res = await start()

        expect(await res.json()).toEqual({ authorizationUrl: 'https://connect.composio.dev/link/x' })
        expect(initiateConnectedAccount).toHaveBeenCalledWith(composioUserId(AGENT_ID), 'ac_gmail', expect.any(String))
    })

    it("names the workspace it started in, which the callback's popup cannot", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: entry } })

        const res = await start()

        const [cookie] = res.cookies.getAll()
        expect(decodeComposioContext(cookie.value)).toMatchObject({ agentId: AGENT_ID, key: 'gmail', workspaceId: 7 })
    })

    it("connects an account the Vault lends as the entry's own user of the workspace, whatever user the box names", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: { ...entry, vaultItemId: 'item-1' } } })
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1', composio: { toolkit: 'gmail', serverName: 'gmail', userId: composioUserId(FOREIGN_COWORKER) } } as never)

        await start()

        expect(initiateConnectedAccount).toHaveBeenCalledTimes(1)
        expect(initiateConnectedAccount).toHaveBeenCalledWith(composioVaultOwnUserId(7, 'item-1'), 'ac_gmail', expect.any(String))
    })
})

describe('POST /api/oauth/composio/start, for a Vault entry', () => {
    it('starts with no coworker, bound to the entry and the workspace', async () => {
        vi.mocked(readItem).mockResolvedValue({ id: 'item-1', slug: 'gmail', name: 'Gmail', composio: { toolkit: 'gmail', serverName: 'gmail' } } as never)

        const res = await start({ vaultItemId: 'item-1' })

        expect(await res.json()).toEqual({ authorizationUrl: 'https://connect.composio.dev/link/x' })
        expect(initiateConnectedAccount).toHaveBeenCalledWith(composioVaultOwnUserId(7, 'item-1'), 'ac_gmail', expect.any(String))
        expect(decodeComposioContext(res.cookies.getAll()[0].value)).toMatchObject({ agentId: '', key: 'item-1', vault: { itemId: 'item-1', workspaceId: 7 } })
        expect(assertAgentAccess).not.toHaveBeenCalled()
    })

    it('refuses a member who may not add to the Vault, and an entry of no workspace of theirs', async () => {
        vi.mocked(assertCanAdd).mockRejectedValueOnce(new AppError('vaultManageOnly'))
        expect(await (await start({ vaultItemId: 'item-1' })).json()).toMatchObject({ code: 'vaultManageOnly' })
        vi.mocked(readItem).mockRejectedValueOnce(new AppError('vaultItemNotFound'))
        expect(await (await start({ vaultItemId: 'item-9' })).json()).toMatchObject({ code: 'vaultItemNotFound' })
        expect(initiateConnectedAccount).not.toHaveBeenCalled()
    })
})
