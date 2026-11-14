import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'

export type SupabaseCall = { table: string; method: string; args: unknown[] }
export type SupabaseResult = { data?: unknown; error?: unknown; count?: number | null }

export type SupabaseResolver = (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

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
        chainsOn: (table: string) => chains.filter(own => own[0].table === table),
        writes: (table: string) =>
            chains
                .filter(own => own[0].table === table)
                .flatMap(own => own.filter(call => WRITE_METHODS.has(call.method)).map(call => ({ method: call.method, payload: call.args[0], filters: own.filter(c => c.method !== 'from' && !WRITE_METHODS.has(c.method)) }))),
    }
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>

export function writeMethodOf(calls: readonly SupabaseCall[]): string | null {
    return calls.find(call => WRITE_METHODS.has(call.method))?.method ?? null
}
