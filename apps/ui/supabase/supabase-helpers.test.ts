import { describe, expect, it } from 'vitest'

import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

import { selectAll, selectCount, selectMany, selectMaybeSingle, selectSingle } from './supabase-helpers'

const filtersOf = (calls: readonly SupabaseCall[]) => calls.filter(call => !['from', 'select', 'single', 'maybeSingle'].includes(call.method)).map(call => [call.method, ...call.args])

describe('filters', () => {
    it('turns a plain value into eq, an array into in, and skips undefined', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, { workspace_id: 3, id: ['a', 'b'], name: undefined })

        expect(filtersOf(db.chains[0])).toEqual([
            ['eq', 'workspace_id', 3],
            ['in', 'id', ['a', 'b']],
        ])
    })

    it('maps each operator object onto its PostgREST method', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, {
            id: { neq: 'x' },
            name: { ilike: '%bot%' },
            engine_agent_id: { notNull: true },
            disabled_at: { isNull: true },
            space_id: { in: ['s'] },
        })

        expect(filtersOf(db.chains[0])).toEqual([
            ['neq', 'id', 'x'],
            ['ilike', 'name', '%bot%'],
            ['not', 'engine_agent_id', 'is', null],
            ['is', 'disabled_at', null],
            ['in', 'space_id', ['s']],
        ])
    })

    it('keeps both ends of a range', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, { created_at: { gte: '2026-01-01', lte: '2026-02-01' } })

        expect(filtersOf(db.chains[0])).toEqual([
            ['gte', 'created_at', '2026-01-01'],
            ['lte', 'created_at', '2026-02-01'],
        ])
    })

    it('ORs the columns listed under `or` and quotes the values that would break the grammar', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, { workspace_id: 1, or: { name: { ilike: '%a,b%' }, handle: { eq: 'plain' }, id: ['x.y', 'z'] } })

        expect(filtersOf(db.chains[0])).toEqual([
            ['eq', 'workspace_id', 1],
            ['or', 'name.ilike."%a,b%",handle.eq.plain,id.in.("x.y",z)'],
        ])
    })

    it('leaves out an `or` whose columns are all undefined', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, { or: { name: undefined } })

        expect(filtersOf(db.chains[0])).toEqual([])
    })
})

describe('selectSingle and selectMaybeSingle', () => {
    it('select the listed columns, order when asked, and end on the matching terminator', async () => {
        const db = fakeSupabase(() => ({ data: { id: 'a' } }))

        await expect(selectSingle(db.client, 'agents', ['id', 'name'] as const, { id: 'a' }, { column: 'created_at' })).resolves.toEqual({ data: { id: 'a' }, error: null })
        await selectMaybeSingle(db.client, 'agents', ['id'] as const, { id: 'a' }, { column: 'created_at', ascending: false })

        expect(db.chains[0].map(call => call.method)).toEqual(['from', 'select', 'eq', 'order', 'single'])
        expect(db.chains[0][1].args).toEqual(['id,name'])
        expect(db.chains[0][3].args).toEqual(['created_at', { ascending: true }])
        expect(db.chains[1].map(call => call.method)).toEqual(['from', 'select', 'eq', 'order', 'maybeSingle'])
        expect(db.chains[1][3].args).toEqual(['created_at', { ascending: false }])
    })
})

describe('selectMany', () => {
    it('pages with range from an offset, 50 rows when no limit is given', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, {}, undefined, undefined, 100)

        expect(db.chains[0].find(call => call.method === 'range')?.args).toEqual([100, 149])
    })

    it('uses limit alone when there is no offset', async () => {
        const db = fakeSupabase()
        await selectMany(db.client, 'agents', ['id'] as const, {}, undefined, 5)

        expect(db.chains[0].map(call => call.method)).toEqual(['from', 'select', 'limit'])
    })
    it('orders by multiple columns when given an array of order specs', async () => {
        const db = fakeSupabase()
        await selectMany(
            db.client,
            'services',
            ['slug', 'name', 'category'] as const,
            { enabled: true },
            [{ column: 'category' }, { column: 'name', ascending: false }],
        )

        expect(db.chains[0].map(call => call.method)).toEqual(['from', 'select', 'eq', 'order', 'order'])
        expect(db.chains[0][3].args).toEqual(['category', { ascending: true }])
        expect(db.chains[0][4].args).toEqual(['name', { ascending: false }])
    })

})

describe('selectAll', () => {
    const rows = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ id: String(from + index) }))

    it('walks the pages of 1000 until a short one', async () => {
        const pages = [rows(1000), rows(1000, 1000), rows(3, 2000)]
        const db = fakeSupabase(() => ({ data: pages.shift() }))

        const { data, error } = await selectAll(db.client, 'agents', ['id'] as const, {})

        expect(error).toBeNull()
        expect(data).toHaveLength(2003)
        expect(db.chains.map(chain => chain.find(call => call.method === 'range')?.args)).toEqual([
            [0, 999],
            [1000, 1999],
            [2000, 2999],
        ])
    })

    it('stops on an empty page without a trailing read', async () => {
        const pages = [rows(1000), []]
        const db = fakeSupabase(() => ({ data: pages.shift() }))

        await expect(selectAll(db.client, 'agents', ['id'] as const, {})).resolves.toMatchObject({ data: { length: 1000 } })
        expect(db.chains).toHaveLength(2)
    })

    it('answers the error of any page rather than the rows gathered so far', async () => {
        const failure = { message: 'boom' }
        const pages: { data?: unknown; error?: unknown }[] = [{ data: rows(1000) }, { error: failure }]
        const db = fakeSupabase(() => pages.shift())

        await expect(selectAll(db.client, 'agents', ['id'] as const, {})).resolves.toEqual({ data: null, error: failure })
    })
})

describe('selectCount', () => {
    it('counts on * by default, so a table without an id column is counted rather than read as zero', async () => {
        const db = fakeSupabase(() => ({ count: 4 }))

        await expect(selectCount(db.client, 'workspace_members', { workspace_id: 7 })).resolves.toEqual({ data: 4, error: null })
        expect(db.chains[0][1].args).toEqual(['*', { count: 'exact', head: true }])
    })

    it('counts on the column it is given', async () => {
        const db = fakeSupabase(() => ({ count: 2 }))
        await selectCount(db.client, 'services', {}, 'slug')

        expect(db.chains[0][1].args).toEqual(['slug', { count: 'exact', head: true }])
    })
})
