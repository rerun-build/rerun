import { fakeSupabase, writeMethodOf, type SupabaseCall } from '@/test/supabase-fake'

type Row = Record<string, unknown>

// A table held in memory behind the fake Supabase client: reads honour the filters the @rerun/db
// helpers send (eq, in, is, lte, not is null), writes change the rows, and the primary key and the
// unique columns refuse a duplicate with Postgres' 23505. For the services whose rules live in which row a query finds,
// where a canned answer would only test the canned answer.
export function memoryTables(tables: Record<string, { rows: Row[]; unique?: string[]; primaryKey?: string[] }>) {
    const matches = (row: Row, calls: readonly SupabaseCall[]) =>
        calls.every(({ method, args }) => {
            const [column, a, b] = args as [string, unknown, unknown]
            if (method === 'eq') return row[column] === a
            if (method === 'in') return (a as unknown[]).includes(row[column])
            if (method === 'is') return a === null ? row[column] == null : row[column] === a
            if (method === 'lte') return row[column] != null && String(row[column]) <= String(a)
            if (method === 'not' && a === 'is' && b === null) return row[column] != null
            return true
        })

    const fake = fakeSupabase((table, calls) => {
        const store = tables[table]
        if (!store) return undefined
        const found = store.rows.filter(row => matches(row, calls))
        const write = writeMethodOf(calls)
        const single = calls.some(call => call.method === 'single' || call.method === 'maybeSingle')

        if (write === 'update') {
            const payload = calls.find(call => call.method === 'update')!.args[0] as Row
            for (const column of store.unique ?? []) {
                const value = payload[column]
                if (value != null && store.rows.some(row => row[column] === value && !found.includes(row))) {
                    return { error: { code: '23505', message: `duplicate key value violates unique constraint on ${column}` } }
                }
            }
            for (const row of found) Object.assign(row, payload)
            return { data: found.map(row => ({ ...row })), error: null }
        }
        if (write === 'insert') {
            const payload = calls.find(call => call.method === 'insert')!.args[0] as Row
            const key = store.primaryKey
            if (key && store.rows.some(row => key.every(column => row[column] === payload[column]))) {
                return { error: { code: '23505', message: `duplicate key value violates the primary key (${key.join(', ')})` } }
            }
            store.rows.push({ ...payload })
            return { data: [payload], error: null }
        }
        if (write === 'delete') {
            store.rows = store.rows.filter(row => !found.includes(row))
            return { data: null, error: null }
        }
        if (single) return { data: found[0] ? { ...found[0] } : null, error: null }
        return { data: found.map(row => ({ ...row })), error: null }
    })

    return { ...fake, tables }
}
