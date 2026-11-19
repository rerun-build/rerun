import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'

export type SupabaseCall = { table: string; method: string; args: unknown[] }
export type SupabaseResult = { data?: unknown; error?: unknown; count?: number | null }

// What one chain resolves to, given the table it started on and every call made along it. A chain
// is `from(table)` followed by any builder methods, awaited once: `.eq().select().single()` and
// friends all land on the same answer, so a resolver switches on `table` and, when it has to, on
// the first write method in `calls`.
export type SupabaseResolver = (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

// A Supabase client that records every builder call instead of reaching a database. The helpers in
// @rerun/db and the raw writes both go through `from(...)`, so the same fake serves a test of the
// read helpers themselves and a test asserting what a service writes.
export function fakeSupabase(resolve: SupabaseResolver = () => undefined) {
    const calls: SupabaseCall[] = []
    const chains: SupabaseCall[][] = []

    function chain(table: string, first: SupabaseCall) {
        const own: SupabaseCall[] = [first]
        chains.push(own)
        calls.push(first)
        const builder: object = new Proxy(
            {},
            {
                get(_target, prop) {
                    if (prop === 'then') {
                        const result = { data: null, error: null, count: null, ...resolve(table, own) }
                        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected)
                    }
                    return (...args: unknown[]) => {
                        const call = { table, method: String(prop), args }
                        own.push(call)
                        calls.push(call)
                        return builder
                    }
                },
            },
        )
        return builder
    }

    const client = {
        from: (table: string) => chain(table, { table, method: 'from', args: [table] }),
        rpc: (fn: string, args?: unknown) => chain(`rpc:${fn}`, { table: `rpc:${fn}`, method: 'rpc', args: [fn, args] }),
    }

    return {
        client: client as unknown as SupabaseClient<Database>,
        calls,
        chains,
        // The calls of every chain started on `table`, in order.
        chainsOn: (table: string) => chains.filter(own => own[0].table === table),
        // The payload of every insert/update/upsert, and a `delete` marker, made on `table`.
        writes: (table: string) =>
            chains
                .filter(own => own[0].table === table)
                .flatMap(own => own.filter(call => WRITE_METHODS.has(call.method)).map(call => ({ method: call.method, payload: call.args[0], filters: own.filter(c => c.method !== 'from' && !WRITE_METHODS.has(c.method)) }))),
    }
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>

// The first write method of a chain, or null for a read.
export function writeMethodOf(calls: readonly SupabaseCall[]): string | null {
    return calls.find(call => WRITE_METHODS.has(call.method))?.method ?? null
}

type Row = Record<string, unknown>

function likePattern(pattern: string, flags: string): RegExp {
    return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, flags)
}

function keeps(row: Row, { method, args }: SupabaseCall): boolean {
    const [column, value] = args as [string, unknown]
    const cell = row[column]
    if (method === 'eq') return cell === value
    if (method === 'neq') return cell !== value
    if (method === 'in') return (value as unknown[]).includes(cell)
    if (method === 'is') return cell === value
    if (method === 'not') return cell !== args[2]
    if (method === 'gt') return (cell as string | number) > (value as string | number)
    if (method === 'gte') return (cell as string | number) >= (value as string | number)
    if (method === 'lt') return (cell as string | number) < (value as string | number)
    if (method === 'lte') return (cell as string | number) <= (value as string | number)
    if (method === 'like') return typeof cell === 'string' && likePattern(String(value), '').test(cell)
    if (method === 'ilike') return typeof cell === 'string' && likePattern(String(value), 'i').test(cell)
    return true
}

// A resolver that answers reads from rows held per table, the way PostgREST would: the filters of the
// chain, its order, its limit, one row for single() and maybeSingle(). A write answers its payload.
export function tableResolver(tables: Record<string, readonly object[]>): SupabaseResolver {
    return (table, calls) => {
        const write = calls.find(call => WRITE_METHODS.has(call.method))
        if (write) return { data: write.method === 'delete' ? null : write.args[0] }
        let rows = ((tables[table] ?? []) as Row[]).filter(row => calls.every(call => keeps(row, call)))
        for (const call of calls.filter(c => c.method === 'order')) {
            const [column, options] = call.args as [string, { ascending?: boolean } | undefined]
            const direction = options?.ascending === false ? -1 : 1
            rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -direction : String(a[column]) > String(b[column]) ? direction : 0))
        }
        const limit = calls.find(call => call.method === 'limit')
        if (limit) rows = rows.slice(0, limit.args[0] as number)
        const count = calls.some(call => call.method === 'select' && (call.args[1] as { count?: string } | undefined)?.count) ? rows.length : null
        if (calls.some(call => call.method === 'single' || call.method === 'maybeSingle')) return { data: rows[0] ?? null, count }
        return { data: rows, count }
    }
}
