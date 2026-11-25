import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))

const { selectMaybeSingle, selectMany, claimDataRead, claimDataWrite, getWorkspaceConnection, engine } = vi.hoisted(() => ({
    selectMaybeSingle: vi.fn(),
    selectMany: vi.fn(),
    claimDataRead: vi.fn(),
    claimDataWrite: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    engine: { listDbTables: vi.fn(), readDbTableRows: vi.fn(), insertDbTableRow: vi.fn(), updateDbTableRow: vi.fn() },
}))

vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle, selectMany }))
vi.mock('@/lib/published/codes', () => ({ claimDataRead, claimDataWrite }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection, NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), ...engine }))

const { answerDataRequest } = await import('./data-api')
const { EngineRequestError } = await import('@/lib/engine/client')

const ORIGIN = 'https://client-directory.rerun.site'
const COWORKER = '7b0e2c1a-0000-4000-8000-000000000001'
const entry = {
    slug: 'client-directory',
    workspace_id: 12,
    data_tables: [
        { database: 'shared', table: 'clients', grant: 'write' },
        { database: COWORKER, table: 'deals', grant: 'read' },
    ],
}

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' }) {
    const request = new Request(`${ORIGIN}/__rerun/data/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return answerDataRequest(entry, request, path.split('/'), ORIGIN)
}

beforeEach(() => {
    vi.clearAllMocks()
    getWorkspaceConnection.mockResolvedValue({ baseUrl: 'http://engine', apiKey: 'k' })
    selectMaybeSingle.mockResolvedValue({ data: { engine_agent_id: 'ana' } })
    selectMany.mockResolvedValue({ data: [{ id: COWORKER, engine_agent_id: 'ana' }] })
    claimDataRead.mockResolvedValue(true)
    claimDataWrite.mockResolvedValue(true)
    engine.readDbTableRows.mockResolvedValue({ columns: ['name'], rows: [{ __rowid: 1, name: 'Marie' }], total: 1 })
    engine.insertDbTableRow.mockResolvedValue({ __rowid: 2, name: 'Tom' })
    engine.updateDbTableRow.mockResolvedValue({ __rowid: 1, name: 'Marie L.' })
})

describe('reading', () => {
    it('lists the granted tables only, with their columns', async () => {
        engine.listDbTables.mockImplementation(async (_conn: unknown, base: string) =>
            base === '/shared/data'
                ? [
                      { name: 'clients', columns: [{ name: 'name', type: 'TEXT', pk: false, notnull: true }] },
                      { name: 'invoices', columns: [] },
                  ]
                : [{ name: 'deals', columns: [] }]
        )
        const res = await call('GET', 'tables')
        expect(res.status).toBe(200)
        const { tables } = (await res.json()) as { tables: { name: string; grant: string }[] }
        expect(tables.map(table => [table.name, table.grant])).toEqual([
            ['clients', 'write'],
            ['deals', 'read'],
        ])
        expect(engine.listDbTables).toHaveBeenCalledWith(expect.anything(), '/agents/ana/data')
    })

    it('reads the rows of a granted table, the limit capped', async () => {
        const res = await call('GET', 'tables/deals/rows')
        expect(res.status).toBe(200)
        const request = new Request(`${ORIGIN}/__rerun/data/tables/clients/rows?limit=5000&where=${encodeURIComponent(JSON.stringify({ company: 'Globex' }))}`)
        await answerDataRequest(entry, request, ['tables', 'clients', 'rows'], ORIGIN)
        expect(engine.readDbTableRows).toHaveBeenLastCalledWith(expect.anything(), '/shared/data', 'clients', expect.objectContaining({ limit: 200, where: [{ column: 'company', equals: 'Globex' }] }))
    })

    it('answers a table out of the grants as if it did not exist', async () => {
        expect((await call('GET', 'tables/invoices/rows')).status).toBe(404)
        expect(engine.readDbTableRows).not.toHaveBeenCalled()
    })

    it('slows down a visitor that reads too fast', async () => {
        claimDataRead.mockResolvedValue(false)
        expect((await call('GET', 'tables/clients/rows')).status).toBe(429)
        expect((await call('GET', 'tables')).status).toBe(429)
        expect(engine.readDbTableRows).not.toHaveBeenCalled()
        expect(engine.listDbTables).not.toHaveBeenCalled()
    })

    it('passes on the reason the engine refuses a read', async () => {
        engine.readDbTableRows.mockRejectedValueOnce(new EngineRequestError('rerun-engine GET /x failed: 400 {"error":"Column not found: ghost"}', 400))
        const refused = await call('GET', 'tables/clients/rows')
        expect(refused.status).toBe(400)
        expect(await refused.json()).toEqual({ error: 'Column not found: ghost' })
    })

    it('refuses a coworker database outside the workspace of the page', async () => {
        selectMaybeSingle.mockResolvedValue({ data: null })
        expect((await call('GET', 'tables/deals/rows')).status).toBe(404)
        expect(selectMaybeSingle).toHaveBeenCalledWith(expect.anything(), 'agents', ['engine_agent_id'], { id: COWORKER, workspace_id: 12 })
    })
})

describe('writing', () => {
    it('adds and edits a row of a writable table', async () => {
        const added = await call('POST', 'tables/clients/rows', { values: { name: 'Tom' } })
        expect(added.status).toBe(201)
        expect(await added.json()).toEqual({ row: { __rowid: 2, name: 'Tom' } })
        expect(engine.insertDbTableRow).toHaveBeenCalledWith(expect.anything(), '/shared/data', 'clients', { name: 'Tom' })
        expect((await call('PATCH', 'tables/clients/rows/1', { values: { name: 'Marie L.' } })).status).toBe(200)
    })

    it('keeps a readable table read only', async () => {
        expect((await call('POST', 'tables/deals/rows', { values: { name: 'x' } })).status).toBe(403)
        expect((await call('PATCH', 'tables/deals/rows/1', { values: { name: 'x' } })).status).toBe(403)
        expect(engine.insertDbTableRow).not.toHaveBeenCalled()
    })

    it('only takes a JSON write from the page itself', async () => {
        expect((await call('POST', 'tables/clients/rows', { values: { name: 'x' } }, { origin: 'https://evil.example', 'content-type': 'application/json' })).status).toBe(403)
        expect((await call('POST', 'tables/clients/rows', { values: { name: 'x' } }, { origin: ORIGIN, 'content-type': 'text/plain' })).status).toBe(415)
        expect(engine.insertDbTableRow).not.toHaveBeenCalled()
    })

    it('refuses a malformed row before the engine sees it', async () => {
        for (const body of [{}, { values: {} }, { values: { __rowid: 9 } }, { values: { name: { nested: true } } }, { values: { name: 'x'.repeat(10_001) } }]) {
            expect((await call('POST', 'tables/clients/rows', body)).status).toBe(400)
        }
        expect(engine.insertDbTableRow).not.toHaveBeenCalled()
    })

    it('refuses a row over 64 KB, announced or not, before reading it whole', async () => {
        const announced = await call('POST', 'tables/clients/rows', { values: { name: 'x' } }, { origin: ORIGIN, 'content-type': 'application/json', 'content-length': String(65 * 1024) })
        expect(announced.status).toBe(413)
        expect(claimDataWrite).not.toHaveBeenCalled()

        const values = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`note${index}`, 'x'.repeat(9_000)]))
        const streamed = await call('POST', 'tables/clients/rows', { values })
        expect(streamed.status).toBe(413)
        expect(engine.insertDbTableRow).not.toHaveBeenCalled()
    })

    it('takes the quota before reading the body', async () => {
        claimDataWrite.mockResolvedValue(false)
        const request = new Request(`${ORIGIN}/__rerun/data/tables/clients/rows`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: 'not json' })
        expect((await answerDataRequest(entry, request, ['tables', 'clients', 'rows'], ORIGIN)).status).toBe(429)
        expect(request.bodyUsed).toBe(false)
    })

    it('slows down a page that writes too fast', async () => {
        claimDataWrite.mockResolvedValue(false)
        expect((await call('POST', 'tables/clients/rows', { values: { name: 'x' } })).status).toBe(429)
        expect(engine.insertDbTableRow).not.toHaveBeenCalled()
    })

    it('passes the refusal of the engine on, and asks for an update on an engine without the route', async () => {
        engine.insertDbTableRow.mockRejectedValueOnce(new EngineRequestError('rerun-engine POST /x failed: 400 {"error":"NOT NULL constraint failed: clients.name"}', 400))
        const refused = await call('POST', 'tables/clients/rows', { values: { company: 'x' } })
        expect(refused.status).toBe(400)
        expect(await refused.json()).toEqual({ error: 'NOT NULL constraint failed: clients.name' })
        engine.insertDbTableRow.mockRejectedValueOnce(new EngineRequestError('rerun-engine POST /x failed: 404 Not Found', 404))
        expect((await call('POST', 'tables/clients/rows', { values: { name: 'x' } })).status).toBe(503)
    })
})
