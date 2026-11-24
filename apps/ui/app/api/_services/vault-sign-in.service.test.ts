import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

import { AccessDeniedError, requireWorkspaceActor } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/errors'
import { composioUserId, composioVaultOwnUserId, deleteConnectedAccount, getConnectedAccount, initiateConnectedAccount } from '@/lib/composio/client'
import { decodeComposioContext } from '@/lib/composio/oauth'
import { EngineRequestError } from '@/lib/engine/client'
import { getVaultItem, patchVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { decodeManagedContext } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { loadManifest } from './services.service'
import { assertVaultComposioAccount, beginVaultComposio, beginVaultManaged, connectVaultComposio, connectVaultManaged, discardVaultComposioAccount, vaultSignInContext } from './vault-sign-in.service'
import { assertCanAdd, vaultContext } from './vault.service'
import { findWorkspaceEngine } from './workspace-engine.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), requireWorkspaceActor: vi.fn() }))
vi.mock('./services.service', () => ({ loadManifest: vi.fn() }))
vi.mock('./vault.service', async importOriginal => ({ ...(await importOriginal<typeof import('./vault.service')>()), vaultContext: vi.fn(), assertCanAdd: vi.fn() }))
vi.mock('./workspace-engine.service', async importOriginal => ({ ...(await importOriginal<typeof import('./workspace-engine.service')>()), findWorkspaceEngine: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn(), patchVaultItem: vi.fn(), putVaultToken: vi.fn() }))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), getConnectedAccount: vi.fn(), deleteConnectedAccount: vi.fn(), initiateConnectedAccount: vi.fn() }))

const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' } as const
const CTX = { actor: ACTOR, conn: CONN, coworkers: [], byEngineId: new Map() }
const REQ = new Request('https://app.rerun.build/x', { headers: { host: 'app.rerun.build', 'x-forwarded-proto': 'https' } })
const OWN_USER = composioVaultOwnUserId(7, 'item-1')
const COWORKER = '11111111-1111-4111-8111-111111111111'

const GMAIL = serviceManifestSchema.parse({
    slug: 'gmail',
    name: 'Gmail',
    authMethods: [{ id: 'composio', kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_gmail' }, mcpServers: [{ name: 'gmail', transport: 'http', url: 'https://rerun.test/api/mcp/composio/gmail' }] }],
})

const gmailItem = (composio: Record<string, unknown> = {}) => ({ id: 'item-1', slug: 'gmail', name: 'Gmail', status: 'needs_auth', agentIds: [], composio: { toolkit: 'gmail', serverName: 'gmail', ...composio } }) as never
const typeformItem = { id: 'item-2', slug: 'typeform', name: 'Typeform', status: 'needs_auth', agentIds: [], managed: { provider: 'typeform', serverName: 'typeform-k3x9ab' } } as never

const account = (over: Partial<{ id: string; userId: string; authConfigId: string; status: string }> = {}) => ({ id: 'ca_new', userId: OWN_USER, authConfigId: 'ac_gmail', status: 'ACTIVE', toolkit: 'gmail', ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.stubEnv('COMPOSIO_API_KEY', 'key')
    vi.stubEnv('TYPEFORM_ID', 'tf-id')
    vi.stubEnv('TYPEFORM_SECRET', 'tf-secret')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'agents' ? { data: { id: COWORKER } } : undefined)).client)
    vi.mocked(loadManifest).mockResolvedValue(GMAIL)
    vi.mocked(getVaultItem).mockResolvedValue(gmailItem())
    vi.mocked(getConnectedAccount).mockResolvedValue(account())
    vi.mocked(initiateConnectedAccount).mockResolvedValue({ connectedAccountId: 'ca_new', redirectUrl: 'https://connect.composio.dev/link/x' })
    vi.mocked(getManagedProvider).mockImplementation(id =>
        id === 'typeform' ? { id, label: 'Typeform', tools: [], oauth: { authorizationEndpoint: 'https://tf.test/authorize', tokenEndpoint: 'https://tf.test/token', scopes: [], clientIdEnv: 'TYPEFORM_ID', clientSecretEnv: 'TYPEFORM_SECRET' } } : undefined,
    )
})

afterEach(() => vi.unstubAllEnvs())

describe('beginVaultComposio', () => {
    it("starts under the entry's own user of the workspace, bound to the entry and to no coworker", async () => {
        const { url, cookie } = await beginVaultComposio(REQ, 7, gmailItem())

        expect(url).toBe('https://connect.composio.dev/link/x')
        expect(initiateConnectedAccount).toHaveBeenCalledWith(OWN_USER, 'ac_gmail', expect.stringContaining('https://app.rerun.build/api/oauth/composio/callback?state='))
        expect(cookie).toMatchObject({ name: expect.stringMatching(/^composio_oauth_/), path: '/api/oauth/composio' })
        expect(decodeComposioContext(cookie.value)).toEqual({ agentId: '', key: 'item-1', toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_new', vault: { itemId: 'item-1', workspaceId: 7 } })
    })

    it('never starts for a user of another workspace the box names', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
        await beginVaultComposio(REQ, 7, gmailItem({ userId: composioUserId(COWORKER) }))
        expect(initiateConnectedAccount).toHaveBeenCalledWith(OWN_USER, 'ac_gmail', expect.any(String))
    })

    it('refuses an entry whose app has no Composio sign-in, or another toolkit than the one it names', async () => {
        await expect(beginVaultComposio(REQ, 7, typeformItem)).rejects.toMatchObject({ code: 'noProviderConnectionToSetUp' })
        await expect(beginVaultComposio(REQ, 7, gmailItem({ toolkit: 'googledrive' }))).rejects.toMatchObject({ code: 'noProviderConnectionToSetUp' })
        expect(initiateConnectedAccount).not.toHaveBeenCalled()
    })

    it('says what the install is missing', async () => {
        vi.mocked(loadManifest).mockResolvedValue(serviceManifestSchema.parse({ ...GMAIL, authMethods: [{ ...GMAIL.authMethods[0], composio: { toolkit: 'gmail', authConfigId: '' } }] }))
        await expect(beginVaultComposio(REQ, 7, gmailItem())).rejects.toMatchObject({ code: 'composioAuthConfigMissing', params: { name: 'Gmail', toolkit: 'gmail' } })
        vi.stubEnv('COMPOSIO_API_KEY', '')
        await expect(beginVaultComposio(REQ, 7, gmailItem())).rejects.toMatchObject({ code: 'composioNotConfigured' })
    })
})

describe('beginVaultManaged', () => {
    it("starts with the entry's provider and server, bound to the entry", async () => {
        const { url, cookie } = await beginVaultManaged(REQ, 7, typeformItem, undefined)

        expect(new URL(url).searchParams.get('client_id')).toBe('tf-id')
        expect(decodeManagedContext(cookie.value)).toMatchObject({ agentId: '', key: 'item-2', provider: 'typeform', serverName: 'typeform-k3x9ab', vault: { itemId: 'item-2', workspaceId: 7 } })
    })

    it('refuses an entry with no managed sign-in, an unknown provider and one the install has no client for', async () => {
        await expect(beginVaultManaged(REQ, 7, gmailItem())).rejects.toMatchObject({ code: 'vaultEntryOtherServer' })
        await expect(beginVaultManaged(REQ, 7, { id: 'x', managed: { provider: 'gone', serverName: 's' } } as never)).rejects.toMatchObject({ code: 'unknownOAuthProvider' })
        vi.stubEnv('TYPEFORM_ID', '')
        await expect(beginVaultManaged(REQ, 7, typeformItem)).rejects.toMatchObject({ code: 'providerNotConfigured' })
    })
})

describe('vaultSignInContext', () => {
    it('acts in the workspace the sign-in started in, as its member', async () => {
        vi.mocked(requireWorkspaceActor).mockResolvedValue(ACTOR)
        vi.mocked(vaultContext).mockResolvedValue(CTX)
        expect(await vaultSignInContext(7)).toBe(CTX)
        expect(requireWorkspaceActor).toHaveBeenCalledWith(7)
        expect(vaultContext).toHaveBeenCalledWith(ACTOR)
    })

    it('refuses who is not a member of it, and who may not add to its Vault', async () => {
        vi.mocked(requireWorkspaceActor).mockRejectedValueOnce(new AuthorizationError('notMember'))
        await expect(vaultSignInContext(8)).rejects.toMatchObject({ code: 'notMember' })
        vi.mocked(requireWorkspaceActor).mockResolvedValue(ACTOR)
        vi.mocked(vaultContext).mockResolvedValue(CTX)
        vi.mocked(assertCanAdd).mockRejectedValueOnce(new AccessDeniedError('vaultManageOnly'))
        await expect(vaultSignInContext(7)).rejects.toMatchObject({ code: 'vaultManageOnly' })
    })
})

describe('connectVaultComposio', () => {
    it('turns the entry active on the checked account', async () => {
        await connectVaultComposio(CTX, 'item-1', 'ca_new')
        expect(patchVaultItem).toHaveBeenCalledWith(CONN, 'item-1', { status: 'active', composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_new' } })
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
    })

    it('keeps the user a migrated entry was connected under', async () => {
        const userId = composioUserId(COWORKER)
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ userId }))
        vi.mocked(getConnectedAccount).mockResolvedValue(account({ userId }))
        await connectVaultComposio(CTX, 'item-1', 'ca_new')
        expect(patchVaultItem).toHaveBeenCalledWith(CONN, 'item-1', expect.objectContaining({ composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_new', userId } }))
    })

    it('deletes the account it had, once the new one is in', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ connectedAccountId: 'ca_old' }))
        await connectVaultComposio(CTX, 'item-1', 'ca_new')
        expect(deleteConnectedAccount).toHaveBeenCalledExactlyOnceWith('ca_old')
        expect(vi.mocked(patchVaultItem).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteConnectedAccount).mock.invocationCallOrder[0])
    })

    it('leaves a former account that is not its own, and stays connected when Composio refuses the delete', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ connectedAccountId: 'ca_old' }))
        vi.mocked(getConnectedAccount).mockImplementation(async id => account(id === 'ca_old' ? { id, userId: 'local_vault_9_item-1' } : {}))
        await connectVaultComposio(CTX, 'item-1', 'ca_new')
        expect(deleteConnectedAccount).not.toHaveBeenCalled()

        vi.mocked(getConnectedAccount).mockResolvedValue(account())
        vi.mocked(deleteConnectedAccount).mockRejectedValueOnce(new Error('down'))
        await expect(connectVaultComposio(CTX, 'item-1', 'ca_new')).resolves.toBeUndefined()
    })

    it('keeps the account when the same one comes back', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ connectedAccountId: 'ca_new' }))
        await connectVaultComposio(CTX, 'item-1', 'ca_new')
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
    })

    it('writes nothing for an account of another user or auth config, one not active, or an entry gone', async () => {
        for (const refused of [account({ userId: composioVaultOwnUserId(8, 'item-1') }), account({ userId: composioVaultOwnUserId(7, 'item-2') }), account({ authConfigId: 'ac_drive' })]) {
            vi.mocked(getConnectedAccount).mockResolvedValue(refused)
            await expect(connectVaultComposio(CTX, 'item-1', 'ca_new')).rejects.toMatchObject({ code: 'connectionMismatch' })
        }
        vi.mocked(getConnectedAccount).mockResolvedValue(account({ status: 'FAILED' }))
        await expect(connectVaultComposio(CTX, 'item-1', 'ca_new')).rejects.toMatchObject({ code: 'connectionNotActiveYet' })
        vi.mocked(getVaultItem).mockRejectedValue(new EngineRequestError('404', 404))
        await expect(assertVaultComposioAccount(CTX, 'item-1', 'ca_new')).rejects.toMatchObject({ code: 'vaultItemNotFound' })
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
    })
})

describe('discardVaultComposioAccount', () => {
    const ABANDONED = { workspaceId: 7, itemId: 'item-1', connectedAccountId: 'ca_new' }
    beforeEach(() => void vi.mocked(findWorkspaceEngine).mockResolvedValue({ conn: CONN } as never))

    it('deletes the account the entry never recorded, and leaves the one it has', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ connectedAccountId: 'ca_old' }))
        await discardVaultComposioAccount(ABANDONED)
        expect(findWorkspaceEngine).toHaveBeenCalledWith(7)
        expect(deleteConnectedAccount).toHaveBeenCalledExactlyOnceWith('ca_new')
        expect(patchVaultItem).not.toHaveBeenCalled()
    })

    it('keeps the account the entry names, for a callback played again', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(gmailItem({ connectedAccountId: 'ca_new' }))
        await discardVaultComposioAccount(ABANDONED)
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
    })

    it('deletes it when the entry is gone, its engine does not answer or the workspace has none', async () => {
        vi.mocked(getVaultItem).mockRejectedValueOnce(new EngineRequestError('404', 404)).mockRejectedValueOnce(new Error('fetch failed'))
        await discardVaultComposioAccount(ABANDONED)
        await discardVaultComposioAccount(ABANDONED)
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
        await discardVaultComposioAccount(ABANDONED)
        expect(deleteConnectedAccount).toHaveBeenCalledTimes(3)
    })

    it('never throws when Composio refuses', async () => {
        vi.mocked(deleteConnectedAccount).mockRejectedValueOnce(new Error('down'))
        await expect(discardVaultComposioAccount(ABANDONED)).resolves.toBeUndefined()
    })
})

describe('connectVaultManaged', () => {
    beforeEach(() => vi.mocked(getVaultItem).mockResolvedValue(typeformItem))

    it("puts the token under the entry's server with Rerun's own client, then turns it active under its email", async () => {
        await connectVaultManaged(CTX, 'item-2', 'typeform', { accessToken: 'at', refreshToken: 'rt' }, 'ops@acme.test')
        expect(putVaultToken).toHaveBeenCalledWith(CONN, 'item-2', 'typeform-k3x9ab', expect.objectContaining({ accessToken: 'at', refreshToken: 'rt', tokenEndpoint: 'https://tf.test/token', clientId: 'tf-id', clientSecret: 'tf-secret' }))
        expect(patchVaultItem).toHaveBeenCalledWith(CONN, 'item-2', { status: 'active', managed: { provider: 'typeform', serverName: 'typeform-k3x9ab', accountEmail: 'ops@acme.test' }, label: 'ops@acme.test' })
    })

    it('writes nothing for an entry of another provider, or with no client secret', async () => {
        await expect(connectVaultManaged(CTX, 'item-2', 'facebook', { accessToken: 'at' })).rejects.toMatchObject({ code: 'providerMismatch' })
        vi.stubEnv('TYPEFORM_SECRET', '')
        await expect(connectVaultManaged(CTX, 'item-2', 'typeform', { accessToken: 'at' })).rejects.toMatchObject({ code: 'providerNotConfigured' })
        expect(putVaultToken).not.toHaveBeenCalled()
        expect(patchVaultItem).not.toHaveBeenCalled()
    })
})
