import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteConnectedAccount, getConnectedAccount } from '@/lib/composio/client'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { composioUserForKey, composioVaultUserId, revokeVaultComposioAccount } from './composio'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/composio/client')>()),
    getConnectedAccount: vi.fn(),
    deleteConnectedAccount: vi.fn(async () => {}),
}))

const WORKSPACE_ID = 7
const OWN_COWORKER = '11111111-1111-4111-8111-111111111111'
const FOREIGN_COWORKER = '99999999-9999-4999-8999-999999999999'

const AGENTS = [
    { id: OWN_COWORKER, workspace_id: WORKSPACE_ID },
    { id: FOREIGN_COWORKER, workspace_id: 99 },
]

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const entry = { status: 'active' as const, config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '' }
const gmail = (userId?: string) => ({ toolkit: 'gmail', serverName: 'gmail', ...(userId ? { userId } : {}) })
const account = (userId: string) => ({ id: 'ca-1', userId, authConfigId: 'ac', status: 'ACTIVE', toolkit: 'gmail' })

function eqValue(calls: readonly SupabaseCall[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('COMPOSIO_USER_NAMESPACE', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = fakeSupabase((table, calls) => {
        if (table !== 'agents') return undefined
        const match = AGENTS.find(agent => agent.id === eqValue(calls, 'id') && agent.workspace_id === eqValue(calls, 'workspace_id'))
        return { data: match ? { id: match.id } : null }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
})

afterEach(() => vi.unstubAllEnvs())

describe("the Composio user of a Vault entry's account", () => {
    it('is one of its own, under the authenticated workspace', async () => {
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1' })).toBe('local_vault_7_item-1')
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail() })).toBe('local_vault_7_item-1')
        expect(await composioVaultUserId(8, { id: 'item-1' })).toBe('local_vault_8_item-1')
        expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it('stays the one of the coworker it was migrated from, when that coworker is of the workspace', async () => {
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail(`local_agent_${OWN_COWORKER}`) })).toBe(`local_agent_${OWN_COWORKER}`)
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail(`local_agent_${OWN_COWORKER}_k3x9ab`) })).toBe(`local_agent_${OWN_COWORKER}_k3x9ab`)
    })

    it.each([
        ['a coworker of another workspace', `local_agent_${FOREIGN_COWORKER}`],
        ['an extra account of a coworker of another workspace', `local_agent_${FOREIGN_COWORKER}_k3x9ab`],
        ['a coworker named in another namespace', `prod_agent_${OWN_COWORKER}`],
        ['an entry of another workspace', 'local_vault_99_item-9'],
        ['an entry named the old way', 'local_vault_item-9'],
        ['an instance that is not one', `local_agent_${OWN_COWORKER}_not-an-instance`],
        ['a coworker id that is not one', 'local_agent_agent-1'],
        ['anything else', 'someone'],
    ])('falls back to its own when the box names %s', async (_what, userId) => {
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail(userId) })).toBe('local_vault_7_item-1')
        expect(console.warn).toHaveBeenCalled()
    })

    it('follows the namespace of the server', async () => {
        vi.stubEnv('COMPOSIO_USER_NAMESPACE', 'staging')
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1' })).toBe('staging_vault_7_item-1')
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail(`staging_agent_${OWN_COWORKER}`) })).toBe(`staging_agent_${OWN_COWORKER}`)
        expect(await composioVaultUserId(WORKSPACE_ID, { id: 'item-1', composio: gmail(`local_agent_${OWN_COWORKER}`) })).toBe('staging_vault_7_item-1')
    })

    it('refuses an entry id that is not one', async () => {
        await expect(composioVaultUserId(WORKSPACE_ID, { id: 'item 1/../x' })).rejects.toThrow('Invalid Vault entry id')
    })
})

describe('the Composio user of a connector', () => {
    it("is the entry's for an account the Vault lends, whatever the box says of it", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: { ...entry, vaultItemId: 'item-1' } } })
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1' } as never)
        expect(await composioUserForKey(conn, WORKSPACE_ID, 'e-1', OWN_COWORKER, 'gmail')).toBe('local_vault_7_item-1')

        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1', composio: gmail(`local_agent_${FOREIGN_COWORKER}`) } as never)
        expect(await composioUserForKey(conn, WORKSPACE_ID, 'e-1', OWN_COWORKER, 'gmail')).toBe('local_vault_7_item-1')
    })

    it("is the coworker's own, per account, otherwise", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: {} })
        expect(await composioUserForKey(conn, WORKSPACE_ID, 'e-1', 'agent-1', 'gmail')).toBe('local_agent_agent-1')
        expect(await composioUserForKey(conn, WORKSPACE_ID, 'e-1', 'agent-1', 'gmail@k3x9ab')).toBe('local_agent_agent-1_k3x9ab')
        expect(getVaultItem).not.toHaveBeenCalled()
    })
})

describe('the Composio account of an entry that goes', () => {
    it('is revoked, under the user the entry was connected with', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue(account('local_vault_7_item-1'))
        await revokeVaultComposioAccount(WORKSPACE_ID, { id: 'item-1', composio: { ...gmail(), connectedAccountId: 'ca-1' } })
        expect(deleteConnectedAccount).toHaveBeenCalledWith('ca-1')

        vi.mocked(deleteConnectedAccount).mockClear()
        vi.mocked(getConnectedAccount).mockResolvedValue(account(`local_agent_${OWN_COWORKER}`))
        await revokeVaultComposioAccount(WORKSPACE_ID, { id: 'item-1', composio: { ...gmail(`local_agent_${OWN_COWORKER}`), connectedAccountId: 'ca-1' } })
        expect(deleteConnectedAccount).toHaveBeenCalledWith('ca-1')
    })

    it('asks Composio nothing for an entry that never connected one', async () => {
        await revokeVaultComposioAccount(WORKSPACE_ID, { id: 'item-1' })
        await revokeVaultComposioAccount(WORKSPACE_ID, { id: 'item-1', composio: gmail() })
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
    })

    it.each([
        ['another entry', 'local_vault_7_item-2'],
        ['another workspace', 'local_vault_99_item-1'],
        ['a coworker', `local_agent_${OWN_COWORKER}`],
    ])('is left alone when the box names the account of %s', async (_what, userId) => {
        vi.mocked(getConnectedAccount).mockResolvedValue(account(userId))
        await revokeVaultComposioAccount(WORKSPACE_ID, { id: 'item-1', composio: { ...gmail(), connectedAccountId: 'ca-1' } })
        expect(deleteConnectedAccount).not.toHaveBeenCalled()
        expect(console.warn).toHaveBeenCalled()
    })
})
