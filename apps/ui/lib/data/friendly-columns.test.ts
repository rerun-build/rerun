import { describe, expect, it } from 'vitest'
import { columnLabel, domainOf, externalHref, friendlyColumns, gridColumns, plainValue, relativeDate, rowCurrency } from '@/lib/data/friendly-columns'

const column = (name: string, type = 'TEXT', pk = false) => ({ name, type, pk, notnull: pk })

const leadsColumns = [
    column('rowid', 'INTEGER', true),
    column('email'),
    column('full_name'),
    column('status'),
    column('score', 'INTEGER'),
    column('deal_value', 'REAL'),
    column('website'),
    column('last_contacted_at'),
    column('tags'),
    column('is_decision_maker', 'INTEGER'),
    column('notes'),
]

const leadsRows = [
    { rowid: 1, email: 'camille@maisonverdier.fr', full_name: 'Camille Laurent', status: 'replied', score: 92, deal_value: 12400, website: 'https://maisonverdier.fr', last_contacted_at: '2026-10-13T15:20:00.000Z', tags: '["retail","france"]', is_decision_maker: 1, notes: 'Asked for a demo next Tuesday. Wants to see the WhatsApp follow-up in action before talking price.' },
    { rowid: 2, email: 'jonas@nordlicht.de', full_name: 'Jonas Becker', status: 'qualified', score: 81, deal_value: null, website: 'https://nordlicht.de', last_contacted_at: null, tags: '["saas"]', is_decision_maker: 0, notes: null },
    { rowid: 3, email: 'priya@loophealth.io', full_name: 'Priya Raman', status: 'contacted', score: 64, deal_value: 8900, website: 'https://loophealth.io', last_contacted_at: '2026-10-09 11:45:00', tags: '["health"]', is_decision_maker: 0, notes: null },
    { rowid: 4, email: 'marco@bellini.it', full_name: 'Marco Bellini', status: 'new', score: 47, deal_value: null, website: 'https://bellini.it', last_contacted_at: null, tags: '[]', is_decision_maker: 1, notes: null },
]

const kinds = (columns: ReturnType<typeof friendlyColumns>) => Object.fromEntries(columns.map(c => [c.key, c.kind]))

describe('friendlyColumns', () => {
    it('gives each column of a lead list the kind a person expects', () => {
        expect(kinds(friendlyColumns(leadsColumns, leadsRows))).toEqual({
            rowid: 'number',
            email: 'email',
            full_name: 'title',
            status: 'status',
            score: 'number',
            deal_value: 'currency',
            website: 'url',
            last_contacted_at: 'date',
            tags: 'tags',
            is_decision_maker: 'boolean',
            notes: 'longtext',
        })
    })

    it('hides an INTEGER primary key and leads the grid with the title', () => {
        const columns = friendlyColumns(leadsColumns, leadsRows)
        expect(columns.find(c => c.key === 'rowid')?.hidden).toBe(true)
        expect(gridColumns(columns).map(c => c.key).slice(0, 2)).toEqual(['full_name', 'email'])
        expect(gridColumns(columns).some(c => c.key === 'rowid')).toBe(false)
    })

    it('keeps the order and the columns a view chose', () => {
        const columns = friendlyColumns(leadsColumns, leadsRows)
        expect(gridColumns(columns, ['status', 'email', 'gone']).map(c => c.key)).toEqual(['status', 'email'])
    })

    it('reads a raw sync log without leaking ids or JSON', () => {
        const columns = friendlyColumns(
            [column('invoice_id'), column('amount_cents', 'INTEGER'), column('currency'), column('payload'), column('synced_at'), column('error_message')],
            [
                { invoice_id: 'in_1QmZ8x2eZvKYlo2C', amount_cents: 4900, currency: 'usd', payload: '{"lines":3}', synced_at: '2026-10-14T09:58:00.000Z', error_message: null },
                { invoice_id: 'in_1QmZ7a2eZvKYlo2C', amount_cents: 14700, currency: 'usd', payload: null, synced_at: null, error_message: 'QuickBooks rejected the line: the tax code DE-19 does not exist in this company file.' },
            ],
        )
        expect(kinds(columns)).toMatchObject({ invoice_id: 'code', amount_cents: 'cents', payload: 'json', synced_at: 'date', error_message: 'longtext' })
        expect(columns.find(c => c.key === 'currency')?.hidden).toBe(true)
    })

    it('falls back on the declared type when a page holds no value yet', () => {
        expect(kinds(friendlyColumns([column('done', 'BOOLEAN'), column('count', 'INTEGER')], []))).toEqual({ done: 'boolean', count: 'number' })
    })

    it('never puts thousands separators on a numeric identifier', () => {
        const columns = friendlyColumns(
            [column('company'), column('customer_id', 'INTEGER'), column('year', 'INTEGER'), column('zip'), column('order_total', 'INTEGER')],
            [
                { company: 'Maison Verdier', customer_id: 10234, year: 2026, zip: 75008, order_total: 12400 },
                { company: 'Nordlicht', customer_id: 10235, year: 2025, zip: 10001, order_total: 980 },
            ],
        )
        expect(kinds(columns)).toEqual({ company: 'title', customer_id: 'code', year: 'text', zip: 'text', order_total: 'number' })
        expect(plainValue(10234, 'code')).toBe('10234')
        expect(plainValue(12400, 'number')).toBe('12,400')
    })

    it('only reads money in a column named for it, not in carrier or warranty', () => {
        const names = ['pricing_from', 'total_amount', 'mrr', 'deal_value', 'cost', 'carrier', 'warranty', 'narrative', 'costume']
        const columns = friendlyColumns(
            names.map(name => column(name)),
            [{ pricing_from: 29, total_amount: 120, mrr: 4900, deal_value: 12400, cost: 10, carrier: 'UPS', warranty: '2 years', narrative: 'Long story', costume: 'Pirate' }],
        )
        expect(kinds(columns)).toMatchObject({ pricing_from: 'currency', total_amount: 'currency', mrr: 'currency', deal_value: 'currency', cost: 'currency' })
        expect(columns.filter(c => ['carrier', 'warranty', 'narrative', 'costume'].includes(c.key)).every(c => c.kind !== 'currency')).toBe(true)
    })

    it('keeps the currency column when its values are not ISO codes', () => {
        const columns = friendlyColumns([column('amount', 'REAL'), column('currency')], [{ amount: 12, currency: 'Euro' }, { amount: 30, currency: '€' }])
        expect(columns.find(c => c.key === 'currency')?.hidden).toBeUndefined()
    })
})

describe('columnLabel', () => {
    it('turns code names into words', () => {
        expect(columnLabel('last_contacted_at')).toBe('Last contacted')
        expect(columnLabel('amount_cents')).toBe('Amount')
        expect(columnLabel('is_decision_maker')).toBe('Decision maker')
        expect(columnLabel('profileUrl')).toBe('Profile URL')
    })
})

describe('plainValue', () => {
    it('only puts a currency symbol on an amount when the row names its currency', () => {
        expect(plainValue(12400, 'currency')).toBe('12,400')
        expect(plainValue(12400, 'currency', rowCurrency({ currency: 'eur' }))).toBe('€12,400')
        expect(plainValue(4900, 'cents', 'USD')).toBe('$49.00')
    })

    it('summarizes JSON and tags', () => {
        expect(plainValue('{"a":1,"b":2}', 'json')).toBe('2 details')
        expect(plainValue('["a","b"]', 'tags')).toBe('a, b')
    })

    it('writes nothing for an empty value', () => {
        expect(plainValue(null, 'text')).toBe('')
        expect(plainValue('', 'date')).toBe('')
    })
})

describe('relativeDate', () => {
    const now = Date.parse('2026-10-14T10:00:00.000Z')

    it('says how long ago, and reads SQLite UTC timestamps as UTC', () => {
        expect(relativeDate('2026-10-14T09:59:30.000Z', 'en', now)).toBe('now')
        expect(relativeDate('2026-10-14 08:00:00', 'en', now)).toBe('2 hr. ago')
        expect(relativeDate('2026-10-13T09:00:00.000Z', 'en', now)).toBe('yesterday')
        expect(relativeDate('2026-10-10T10:00:00.000Z', 'en', now)).toBe('4 days ago')
    })

    it('leaves text that is not a date alone', () => {
        expect(relativeDate('soon', 'en', now)).toBe('soon')
    })
})

describe('externalHref', () => {
    it('gives a scheme to a domain written without one', () => {
        expect(externalHref('instagram.com/studio.example')).toBe('https://instagram.com/studio.example')
        expect(externalHref('www.acme.io')).toBe('https://www.acme.io')
        expect(externalHref('acme.com?ref=1')).toBe('https://acme.com?ref=1')
        expect(externalHref('  acme.com  ')).toBe('https://acme.com')
        expect(externalHref('//cdn.acme.com/a')).toBe('https://cdn.acme.com/a')
    })

    it('keeps a link that already has its scheme', () => {
        expect(externalHref('https://instagram.com/x')).toBe('https://instagram.com/x')
        expect(externalHref('http://acme.com')).toBe('http://acme.com')
        expect(externalHref('HTTPS://Acme.com')).toBe('HTTPS://Acme.com')
    })

    it('refuses any other scheme and anything that is not an address', () => {
        expect(externalHref('javascript:alert(1)')).toBeUndefined()
        expect(externalHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
        expect(externalHref('mailto:a@b.co')).toBeUndefined()
        expect(externalHref('@studio.example')).toBeUndefined()
        expect(externalHref('n/a')).toBeUndefined()
        expect(externalHref('hello world')).toBeUndefined()
    })
})

describe('domainOf', () => {
    it('drops the scheme whatever its case', () => {
        expect(domainOf('HTTPS://www.Acme.com/path')).toBe('Acme.com')
        expect(domainOf('instagram.com/studio.example')).toBe('instagram.com')
    })
})
