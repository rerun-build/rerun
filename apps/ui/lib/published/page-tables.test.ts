import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listDbTables } = vi.hoisted(() => ({ listDbTables: vi.fn() }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), listDbTables }))

const { grantsForPage, publishedTables, tablesMessage } = await import('./page-tables')

const conn = { baseUrl: 'http://engine', apiKey: null }
const AGENT_ROW = '7b0e2c1a-0000-4000-8000-000000000001'

beforeEach(() => {
    listDbTables.mockImplementation(async (_conn: unknown, base: string) => (base === '/shared/data' ? [{ name: 'clients', columns: [] }, { name: 'deals', columns: [] }] : [{ name: 'notes', columns: [] }]))
})

describe('grantsForPage', () => {
    it('grants the tables that exist, the shared database or the coworker own one', async () => {
        const { grants, missing } = await grantsForPage(conn, AGENT_ROW, 'ana', [
            { name: 'clients', database: 'shared', access: 'write' },
            { name: 'notes', database: 'own', access: 'read' },
            { name: 'clients', database: 'shared', access: 'read' },
        ])
        expect(grants).toEqual([
            { database: 'shared', table: 'clients', grant: 'write' },
            { database: AGENT_ROW, table: 'notes', grant: 'read' },
        ])
        expect(missing).toEqual([])
        expect(listDbTables).toHaveBeenCalledWith(conn, '/agents/ana/data')
    })

    it('leaves out a table the named database does not have, and says so', async () => {
        const { grants, missing } = await grantsForPage(conn, AGENT_ROW, 'ana', [{ name: 'notes', database: 'shared', access: 'read' }])
        expect(grants).toEqual([])
        expect(missing).toEqual(['notes'])
        expect(tablesMessage(grants, missing)).toContain('No table named notes')
    })

    it('names what the page reads', () => {
        expect(tablesMessage([{ database: 'shared', table: 'clients', grant: 'write' }], [])).toContain('clients (view and add)')
    })
})

describe('publishedTables', () => {
    const clients = { database: 'shared', table: 'clients', grant: 'write' } as const
    const stored = [{ database: 'shared', table: 'deals', grant: 'read' } as const]

    it('stores the tables asked for on a page', () => {
        expect(publishedTables(true, { grants: [clients], missing: [] }, stored)).toMatchObject({ grants: [clients], changed: true })
    })

    it('keeps what a page had when it is republished without tables', () => {
        expect(publishedTables(true, null, stored)).toEqual({ grants: stored, changed: false, message: '' })
    })

    it('grants no table to a file that is not a page, and says so when some were asked', () => {
        const asked = publishedTables(false, { grants: [clients], missing: [] }, stored)
        expect(asked).toMatchObject({ grants: [], changed: true })
        expect(asked.message).toContain('Only a page or a site')
        expect(publishedTables(false, null, stored)).toEqual({ grants: [], changed: true, message: '' })
    })
})
