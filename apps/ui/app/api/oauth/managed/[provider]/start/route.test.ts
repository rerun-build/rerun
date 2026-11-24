import { AccessDeniedError, assertAgentAccess } from '@/app/api/_auth/access'
import { assertCanAdd, readItem } from '@/app/api/_services/vault.service'
import { decodeManagedContext } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { readRegistry, type ServiceRegistry } from '@/lib/services/registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const CONN = { baseUrl: 'https://engine.test', apiKey: null }

vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), assertAgentAccess: vi.fn(async () => ({ actor: { kind: 'workspace', workspaceId: 7 } })) }))
vi.mock('@/app/api/_services/services.service', () => ({ loadManifest: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: CONN, engineAgentId: 'engine-agent' })) }))
vi.mock('@/app/api/_services/vault.service', () => ({ vaultContext: vi.fn(async () => ({ actor: { kind: 'user', userId: 'user-1', workspaceId: 7 }, conn: CONN })), assertCanAdd: vi.fn(), readItem: vi.fn() }))
vi.mock('@/lib/services/registry', () => ({
    readRegistry: vi.fn(),
    resolveRegistryEntry: (registry: ServiceRegistry, key: string) => (registry.services[key] ? { key, entry: registry.services[key] } : null),
}))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: vi.fn() }))

const start = (body: object, provider = 'typeform') => POST(new Request(`https://rerun.test/api/oauth/managed/${provider}/start`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ provider }) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.stubEnv('TYPEFORM_ID', 'tf-id')
    vi.mocked(getManagedProvider).mockImplementation(id => ({ id, label: 'Typeform', tools: [], oauth: { authorizationEndpoint: 'https://tf.test/authorize', tokenEndpoint: 'https://tf.test/token', scopes: [], clientIdEnv: 'TYPEFORM_ID', clientSecretEnv: 'TYPEFORM_SECRET' } }))
    vi.mocked(readItem).mockResolvedValue({ id: 'item-2', managed: { provider: 'typeform', serverName: 'typeform' } } as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/oauth/managed/[provider]/start', () => {
    it("starts a coworker's own account, in the workspace it is in", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { typeform: { status: 'needs_auth', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '', managed: { provider: 'typeform', serverName: 'typeform' } } } })
        const res = await start({ agentId: 'agent-1', key: 'typeform' })
        expect(res.status).toBe(200)
        expect(decodeManagedContext(res.cookies.getAll()[0].value)).toMatchObject({ agentId: 'agent-1', key: 'typeform', workspaceId: 7 })
    })

    it('starts a Vault entry with no coworker', async () => {
        const res = await start({ vaultItemId: 'item-2' })
        expect(res.status).toBe(200)
        expect(new URL((await res.json()).authorizationUrl).origin).toBe('https://tf.test')
        expect(decodeManagedContext(res.cookies.getAll()[0].value)).toMatchObject({ agentId: '', key: 'item-2', vault: { itemId: 'item-2', workspaceId: 7 } })
        expect(assertAgentAccess).not.toHaveBeenCalled()
    })

    it('refuses an entry of another provider', async () => {
        const res = await start({ vaultItemId: 'item-2' }, 'facebook')
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ code: 'vaultEntryOtherServer' })
        expect(res.cookies.getAll()).toEqual([])
    })

    it('refuses a member who may not add to the Vault, before the entry is read', async () => {
        vi.mocked(assertCanAdd).mockRejectedValueOnce(new AccessDeniedError('vaultManageOnly'))
        expect(await (await start({ vaultItemId: 'item-2' })).json()).toMatchObject({ code: 'vaultManageOnly' })
        expect(readItem).not.toHaveBeenCalled()
    })
})
