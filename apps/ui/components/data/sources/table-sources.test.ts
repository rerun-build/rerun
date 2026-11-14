import { TABLE_SOURCES_MAX_ROWS, type TableSourcesResult } from '@rerun/contracts'
import { describe, expect, it, vi } from 'vitest'
import { resolveTableSources, showsSourcesColumn, sourcesRequestRows, type RowSources } from './table-sources'

vi.mock('@rerun/contracts', async importOriginal => ({
    ...(await importOriginal<typeof import('@rerun/contracts')>()),
    paidDataSourceOfCall: (_capability: string, servedBy: string | null) =>
        servedBy ? { id: `vendor:${servedBy.split('.')[0]}`, name: servedBy.split('.')[0], domain: null, kind: 'vendor' } : { id: 'generic', name: 'Data provider', domain: null, kind: 'generic' },
}))

const RESULT: TableSourcesResult = {
    calls: {
        c1: { capability: 'people.email.find', servedBy: 'hunter.find', at: '2026-11-02T10:00:00Z' },
        c2: { capability: 'google.serp.maps', servedBy: 'dataforseo.maps', at: '2026-11-01T10:00:00Z' },
        c3: { capability: 'not.a.capability', servedBy: null, at: '2026-11-01T09:00:00Z' },
    },
    rows: [
        {
            sources: ['c1', 'c2'],
            cells: {
                email: { call: 'c1', field: 'email', verdict: 'valid' },
                website: { call: 'c2', field: 'website', href: 'https://maps.google.com/?cid=1' },
            },
        },
        { sources: [], cells: {} },
        { sources: ['c3'], cells: { name: { call: 'c3', field: 'name', verdict: 'accept_all' } } },
    ],
}

describe('sourcesRequestRows', () => {
    it('sends only the scalar cells a provider could have returned', () => {
        const rows = sourcesRequestRows([{ __rowid: 4, name: 'Chez Paul', score: 3, open: true, phone: null, tags: ['a'], meta: { a: 1 }, note: 'x'.repeat(2001) }])
        expect(rows).toEqual([{ name: 'Chez Paul', score: 3, open: true, phone: null }])
    })

    it('caps the rows at what the engine accepts', () => {
        const rows = Array.from({ length: TABLE_SOURCES_MAX_ROWS + 20 }, (_, i) => ({ name: `Lead ${i}` }))
        expect(sourcesRequestRows(rows)).toHaveLength(TABLE_SOURCES_MAX_ROWS)
    })
})

describe('resolveTableSources', () => {
    const [traced, untraced, generic] = resolveTableSources(RESULT, 3)

    it('names each source once, newest first, and keeps the check of an email', () => {
        expect(traced?.sources.map(source => source.name)).toEqual(['hunter', 'dataforseo'])
        expect(traced?.cells.email).toMatchObject({ source: { name: 'hunter' }, at: '2026-11-02T10:00:00Z', verdict: 'verified' })
        expect(traced?.cells.website).toMatchObject({ source: { name: 'dataforseo' }, href: 'https://maps.google.com/?cid=1', verdict: undefined })
    })

    it('leaves a row with no traced data out', () => {
        expect(untraced).toBeNull()
    })

    it('shows a call with no provider as a generic one and a non-valid verdict as unconfirmed', () => {
        expect(generic?.sources).toEqual([{ id: 'generic', name: 'Data provider', domain: null, kind: 'generic' }])
        expect(generic?.cells.name?.verdict).toBe('unconfirmed')
    })

    it('answers null for a row the engine did not return', () => {
        expect(resolveTableSources({ calls: {}, rows: [] }, 2)).toEqual([null, null])
    })
})

describe('showsSourcesColumn', () => {
    const traced: RowSources = { sources: [{ id: 'vendor:hunter', name: 'Hunter', domain: 'hunter.io', kind: 'vendor' }], cells: {} }
    const rows = [{ name: 'A' }, { name: 'B' }]

    it('appears once a row on screen has a source', () => {
        expect(showsSourcesColumn(rows, row => (row === rows[1] ? traced : null))).toBe(true)
    })

    it('stays away when no row has one', () => {
        expect(showsSourcesColumn(rows, () => null)).toBe(false)
        expect(showsSourcesColumn([], () => traced)).toBe(false)
    })
})
