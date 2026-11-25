import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataGrant } from '@/lib/published/data-grants'

vi.mock('server-only', () => ({}))
vi.spyOn(console, 'warn').mockImplementation(() => {})

const { selectAll, selectMaybeSingle, listDbTables, update } = vi.hoisted(() => ({
    selectAll: vi.fn(),
    selectMaybeSingle: vi.fn(),
    listDbTables: vi.fn(),
    update: vi.fn(),
}))

vi.mock('@/supabase/supabase-helpers', () => ({ selectAll, selectMaybeSingle }))
vi.mock('@/supabase/serviceRole', () => ({
    createServiceRoleClient: () => ({
        from: () => ({ update: (payload: unknown) => (update(payload), { eq: () => ({ eq: async () => ({ error: null }) }) }) }),
    }),
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: async () => ({ baseUrl: 'http://engine', apiKey: 'k' }) }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), listDbTables }))

const { getPageData, updatePageData } = await import('./published-data')

const ANA = '7b0e2c1a-0000-4000-8000-000000000001'
const LEO = '7b0e2c1a-0000-4000-8000-000000000002'

function storeGrants(grants: unknown[]) {
    selectMaybeSingle.mockResolvedValue({ data: { data_tables: grants } })
}

beforeEach(() => {
    vi.clearAllMocks()
    selectAll.mockResolvedValue({
        data: [
            { id: ANA, name: 'Ana', engine_agent_id: 'ana' },
            { id: LEO, name: 'Leo', engine_agent_id: 'leo' },
        ],
    })
    listDbTables.mockImplementation(async (_conn: unknown, base: string) => {
        if (base === '/shared/data') return [{ name: 'clients', columns: [], rows: 3 }]
        if (base === '/agents/ana/data') throw new Error('engine timeout')
        return [{ name: 'notes', columns: [], rows: 1 }]
    })
})

describe('a coworker database the machine could not list', () => {
    const anaDeals: DataGrant = { database: ANA, table: 'deals', grant: 'write' }

    it('still shows its grants, the row count unknown', async () => {
        storeGrants([anaDeals])
        const data = await getPageData(12, 'directory', 'all')
        expect(data.listed).toEqual([{ database: ANA, owner: 'Ana', table: 'deals', rows: null, grant: 'write' }])
        expect(listDbTables).toHaveBeenCalledWith(expect.anything(), '/shared/data', { counts: true })
    })

    it('keeps them when another grant changes', async () => {
        storeGrants([anaDeals])
        await updatePageData(12, 'directory', [anaDeals, { database: 'shared', table: 'clients', grant: 'read' }], 'all')
        expect(update).toHaveBeenCalledWith({ data_tables: [anaDeals, { database: 'shared', table: 'clients', grant: 'read' }] })
    })

    it('lets them be lowered or removed, never raised nor added', async () => {
        storeGrants([{ ...anaDeals, grant: 'read' }])
        await updatePageData(12, 'directory', [{ ...anaDeals, grant: 'write' }, { database: ANA, table: 'leads', grant: 'read' }], 'all')
        expect(update).toHaveBeenLastCalledWith({ data_tables: [] })

        storeGrants([anaDeals])
        await updatePageData(12, 'directory', [{ ...anaDeals, grant: 'read' }], 'all')
        expect(update).toHaveBeenLastCalledWith({ data_tables: [{ ...anaDeals, grant: 'read' }] })

        await updatePageData(12, 'directory', [], 'all')
        expect(update).toHaveBeenLastCalledWith({ data_tables: [] })
    })
})
