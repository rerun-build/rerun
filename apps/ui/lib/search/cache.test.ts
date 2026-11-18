import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, writeMethodOf, type SupabaseResolver } from '@/test/supabase-fake'
import { readCachedSearch, searchCacheKey, storeSearch } from './cache'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const NOW = new Date('2026-10-12T10:00:00.000Z')
const RESULTS = [{ title: 'Rerun', url: 'https://rerun.build', snippet: 'Coworkers that run' }]

function database(resolve: SupabaseResolver) {
    const db = fakeSupabase(resolve)
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

describe('searchCacheKey', () => {
    it('folds case and whitespace so the same question shares one entry', () => {
        expect(searchCacheKey('  Rerun   AI\tagents ')).toBe('rerun ai agents')
        expect(searchCacheKey('rerun ai agents')).toBe('rerun ai agents')
    })
})

describe('readCachedSearch', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW })
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns the results of an entry fetched within the last day', async () => {
        const db = database(() => ({ data: { results: RESULTS } }))

        await expect(readCachedSearch('rerun')).resolves.toEqual(RESULTS)
        expect(db.chainsOn('web_search_cache')[0]).toEqual(
            expect.arrayContaining([
                { table: 'web_search_cache', method: 'eq', args: ['query_key', 'rerun'] },
                { table: 'web_search_cache', method: 'gte', args: ['fetched_at', '2026-10-11T10:00:00.000Z'] },
            ])
        )
    })

    it('misses when nothing fresh is kept', async () => {
        database(() => ({ data: null }))

        await expect(readCachedSearch('rerun')).resolves.toBeNull()
    })

    it('misses rather than fails when the cache cannot be read', async () => {
        database(() => ({ error: { message: 'relation does not exist' } }))
        await expect(readCachedSearch('rerun')).resolves.toBeNull()

        vi.mocked(createServiceRoleClient).mockImplementation(() => {
            throw new Error('network')
        })
        await expect(readCachedSearch('rerun')).resolves.toBeNull()
    })
})

describe('storeSearch', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW })
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('upserts the results under their key, stamped now', async () => {
        const db = database(() => undefined)

        await storeSearch('rerun', RESULTS)

        expect(db.writes('web_search_cache')).toEqual([{ method: 'upsert', payload: { query_key: 'rerun', results: RESULTS, fetched_at: NOW.toISOString() }, filters: [] }])
    })

    it('never throws when the entry cannot be stored', async () => {
        database((_table, calls) => (writeMethodOf(calls) ? { error: { message: 'permission denied' } } : undefined))

        await expect(storeSearch('rerun', RESULTS)).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
})
