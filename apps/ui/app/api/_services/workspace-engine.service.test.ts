import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/capacity.service', () => ({ assertEngineEntitlement: vi.fn() }))
vi.mock('@rerun/cloud/engines', () => ({ claimPoolEngine: vi.fn() }))
vi.mock('@/lib/brain/request-seed', () => ({ requestCompanyBrainSeed: vi.fn() }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { NoEngineError, authenticateEngineToken, findWorkspaceEngine, getWorkspaceConnection } = await import('./workspace-engine.service')
const { forgetMachine, forgetMachineAt } = await import('@/lib/engine/engine-memory')

let db: FakeSupabase
let enginePoolRow: unknown

beforeEach(() => {
    forgetMachine(3)
    forgetMachine(7)
    enginePoolRow = null
    db = fakeSupabase(table => (table === 'engine_pool' ? { data: enginePoolRow } : undefined))
    vi.mocked(createServiceRoleClient).mockReset().mockReturnValue(db.client)
})

function filtersOf(table: string) {
    return db.chainsOn(table)[0].filter(call => call.method === 'eq').map(call => call.args)
}

describe('authenticateEngineToken', () => {
    it('answers null for an empty token without touching the database', async () => {
        await expect(authenticateEngineToken('')).resolves.toBeNull()
        expect(db.calls).toHaveLength(0)
    })

    it('looks the engine up by its key and answers the workspace that claimed it', async () => {
        enginePoolRow = { claimed_by_workspace_id: 7, workspace: { id: 7, is_sandbox: true } }
        await expect(authenticateEngineToken('secret')).resolves.toEqual({ workspaceId: 7, isSandbox: true })
        expect(filtersOf('engine_pool')).toEqual([['engine_api_key', 'secret']])
    })

    it('answers null for an engine nobody claimed', async () => {
        enginePoolRow = { claimed_by_workspace_id: null, workspace: null }
        await expect(authenticateEngineToken('secret')).resolves.toBeNull()
    })

    it('answers null for an unknown key', async () => {
        await expect(authenticateEngineToken('nope')).resolves.toBeNull()
    })
})

describe('getWorkspaceConnection', () => {
    it('builds the connection of the machine claimed by the workspace', async () => {
        enginePoolRow = { id: 'i1', engine_host: '10.0.0.1:3000', engine_api_key: 'k', provider_server_id: 'srv' }
        await expect(getWorkspaceConnection(3)).resolves.toEqual({ baseUrl: 'http://10.0.0.1:3000', apiKey: 'k', workspaceId: 3 })
        expect(filtersOf('engine_pool')).toEqual([['claimed_by_workspace_id', 3]])
    })

    it('throws NoEngineError when the workspace has no machine', async () => {
        await expect(getWorkspaceConnection(3)).rejects.toBeInstanceOf(NoEngineError)
    })

    it('throws NoEngineError for a pool row without a host', async () => {
        enginePoolRow = { id: 'i1', engine_host: null, engine_api_key: 'k', provider_server_id: null }
        await expect(getWorkspaceConnection(3)).rejects.toBeInstanceOf(NoEngineError)
    })
})

describe('the short memory of a machine', () => {
    const row = { id: 'i1', engine_host: '10.0.0.1:3000', engine_api_key: 'k', provider_server_id: 'srv' }

    it('reads the machine of a workspace once for calls that follow each other', async () => {
        enginePoolRow = row
        await findWorkspaceEngine(3)
        await findWorkspaceEngine(3)
        expect(db.chainsOn('engine_pool')).toHaveLength(1)
    })

    it('never keeps an absence, so a machine just claimed is found at once', async () => {
        await expect(findWorkspaceEngine(3)).resolves.toBeNull()
        enginePoolRow = row
        await expect(findWorkspaceEngine(3)).resolves.toMatchObject({ instanceId: 'i1' })
    })

    it('reads again once the entry has run out', async () => {
        vi.useFakeTimers()
        try {
            enginePoolRow = row
            await findWorkspaceEngine(3)
            vi.advanceTimersByTime(31_000)
            enginePoolRow = { ...row, engine_host: '10.0.0.2:3000' }
            await expect(findWorkspaceEngine(3)).resolves.toMatchObject({ conn: { baseUrl: 'http://10.0.0.2:3000' } })
        } finally {
            vi.useRealTimers()
        }
    })

    it('reads again after the machine did not answer at its address', async () => {
        enginePoolRow = row
        await findWorkspaceEngine(3)
        forgetMachineAt('http://10.0.0.1:3000/agents')
        await findWorkspaceEngine(3)
        expect(db.chainsOn('engine_pool')).toHaveLength(2)
    })

    it('reads the workspace of an engine key once, and again once its machine is forgotten', async () => {
        enginePoolRow = { claimed_by_workspace_id: 7, workspace: { id: 7, is_sandbox: false } }
        await authenticateEngineToken('secret-memory')
        await authenticateEngineToken('secret-memory')
        expect(db.chainsOn('engine_pool')).toHaveLength(1)
        forgetMachine(7)
        await authenticateEngineToken('secret-memory')
        expect(db.chainsOn('engine_pool')).toHaveLength(2)
    })

    it('does not keep an engine key nobody claimed', async () => {
        enginePoolRow = { claimed_by_workspace_id: null, workspace: null }
        await authenticateEngineToken('unclaimed')
        await authenticateEngineToken('unclaimed')
        expect(db.chainsOn('engine_pool')).toHaveLength(2)
    })
})
