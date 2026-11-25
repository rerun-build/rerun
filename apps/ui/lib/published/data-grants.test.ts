import { describe, expect, it } from 'vitest'
import { findDataGrant, parseDataGrants } from './data-grants'

describe('parseDataGrants', () => {
    it('keeps the well-formed grants, in order', () => {
        const stored = [
            { database: 'shared', table: 'clients', grant: 'write' },
            { database: '7b0e2c1a-0000-4000-8000-000000000001', table: 'deals', grant: 'read' },
        ]
        expect(parseDataGrants(stored)).toEqual(stored)
    })

    it('drops what it cannot read, and a table named twice keeps its first grant', () => {
        expect(
            parseDataGrants([
                { database: 'shared', table: 'clients', grant: 'read' },
                { database: 'shared', table: 'clients', grant: 'write' },
                { database: 'shared', table: 'deals', grant: 'off' },
                { database: '', table: 'x', grant: 'read' },
                'clients',
                null,
            ])
        ).toEqual([{ database: 'shared', table: 'clients', grant: 'read' }])
    })

    it('reads anything but a list as no grant at all', () => {
        expect(parseDataGrants(null)).toEqual([])
        expect(parseDataGrants({ clients: 'write' })).toEqual([])
    })
})

describe('findDataGrant', () => {
    it('finds a table by its name only', () => {
        const grants = parseDataGrants([{ database: 'shared', table: 'clients', grant: 'write' }])
        expect(findDataGrant(grants, 'clients')?.grant).toBe('write')
        expect(findDataGrant(grants, 'invoices')).toBeNull()
    })
})
