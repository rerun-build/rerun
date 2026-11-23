import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paidAppFlag, unbindAgent } from '@rerun/cloud/apps.server'
import type { Actor } from '@/app/api/_auth/access'
import { assertAgentAccess, visibleSpaceIds } from '@/app/api/_auth/access'
import { selectMany } from '@/supabase/supabase-helpers'
import { attachAgentToConnection, detachAgentFromConnection } from './apps.service'
import { installService, uninstallService } from './services.service'
import { attachVaultPaidAccount, detachVaultPaidAccount, vaultPaidAccounts } from './vault-apps.service'

vi.mock('server-only', () => ({}))
vi.mock('@rerun/cloud/apps.server', () => ({ paidAppFlag: vi.fn(), unbindAgent: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: vi.fn(), requireLightSessionActor: vi.fn(), visibleSpaceIds: vi.fn() }))
vi.mock('./apps.service', () => ({ attachAgentToConnection: vi.fn(), detachAgentFromConnection: vi.fn() }))
vi.mock('./services.service', () => ({ installService: vi.fn(), uninstallService: vi.fn() }))

const actor: Actor = { kind: 'user', userId: 'u-1', workspaceId: 7, role: 'member', boxScope: 'all' }

const TABLES: Record<string, unknown[]> = {
    app_connections: [
        { id: 'conn-a', app_slug: 'linkedin', label: 'Ada', status: 'connected' },
        { id: 'conn-b', app_slug: 'linkedin', label: 'Bea', status: 'needs_reconnect' },
    ],
    app_connection_agents: [
        { agent_id: 'alice', connection_id: 'conn-a' },
        { agent_id: 'carol', connection_id: 'conn-a' },
    ],
    agents: [
        { id: 'alice', space_id: 'box-a' },
        { id: 'carol', space_id: 'box-private' },
    ],
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(paidAppFlag).mockImplementation(async slug => slug === 'linkedin')
    vi.mocked(selectMany).mockImplementation((async (_client: unknown, table: string) => ({ data: TABLES[table] ?? [], error: null })) as never)
    vi.mocked(visibleSpaceIds).mockResolvedValue(new Set(['box-a']) as never)
    vi.mocked(assertAgentAccess).mockResolvedValue({ actor } as never)
})

describe('vaultPaidAccounts', () => {
    it('lists the accounts of the apps switched on, with the coworkers the caller can see', async () => {
        const accounts = await vaultPaidAccounts(actor)
        expect(accounts).toEqual([
            expect.objectContaining({ slug: 'linkedin', connectionId: 'conn-a', label: 'Ada', status: 'connected', agentIds: ['alice'], hiddenAgents: 1 }),
            expect.objectContaining({ slug: 'linkedin', connectionId: 'conn-b', label: 'Bea', status: 'needs_reconnect', agentIds: [], hiddenAgents: 0 }),
        ])
        const query = vi.mocked(selectMany).mock.calls.find(call => call[1] === 'app_connections')
        expect(query?.[3]).toMatchObject({ workspace_id: 7, app_slug: ['linkedin'] })
    })

    it('lists nothing when no paid app is switched on', async () => {
        vi.mocked(paidAppFlag).mockResolvedValue(false)
        expect(await vaultPaidAccounts(actor)).toEqual([])
        expect(selectMany).not.toHaveBeenCalled()
    })
})

describe('attachVaultPaidAccount', () => {
    it('installs the connector and adds the account', async () => {
        await attachVaultPaidAccount('linkedin', 'conn-a', 'bob', actor)
        expect(assertAgentAccess).toHaveBeenCalledWith('bob', 'manage', actor)
        expect(installService).toHaveBeenCalledWith('bob', 'linkedin-pro', {}, undefined, actor)
        expect(attachAgentToConnection).toHaveBeenCalledWith('linkedin', 'bob', 'conn-a', actor)
    })

    it('stops before anything when the caller does not manage the coworker', async () => {
        vi.mocked(assertAgentAccess).mockRejectedValue(new Error('forbidden'))
        await expect(attachVaultPaidAccount('linkedin', 'conn-a', 'bob', actor)).rejects.toThrow('forbidden')
        expect(installService).not.toHaveBeenCalled()
        expect(attachAgentToConnection).not.toHaveBeenCalled()
    })
})

describe('detachVaultPaidAccount', () => {
    const holds = (...ids: string[]) => vi.mocked(selectMany).mockResolvedValue({ data: ids.map(connection_id => ({ connection_id })), error: null } as never)

    it('takes off this account only when the coworker holds others', async () => {
        holds('conn-a', 'conn-b')
        await detachVaultPaidAccount('linkedin', 'conn-a', 'alice', actor)
        expect(detachAgentFromConnection).toHaveBeenCalledWith('linkedin', 'alice', 'conn-a', actor)
        expect(uninstallService).not.toHaveBeenCalled()
        expect(unbindAgent).not.toHaveBeenCalled()
    })

    it('removes the connector with the last account', async () => {
        holds('conn-a')
        await detachVaultPaidAccount('linkedin', 'conn-a', 'alice', actor)
        expect(uninstallService).toHaveBeenCalledWith('alice', 'linkedin-pro', actor)
        expect(unbindAgent).toHaveBeenCalledWith(expect.anything(), 7, 'alice', 'linkedin')
        expect(detachAgentFromConnection).not.toHaveBeenCalled()
    })

    it('leaves a coworker that does not hold this account alone', async () => {
        holds('conn-b')
        await detachVaultPaidAccount('linkedin', 'conn-a', 'alice', actor)
        expect(uninstallService).not.toHaveBeenCalled()
        expect(unbindAgent).not.toHaveBeenCalled()
        expect(detachAgentFromConnection).not.toHaveBeenCalled()
    })
})
