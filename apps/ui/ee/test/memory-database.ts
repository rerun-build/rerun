import { fakeSupabase, keeps, writeMethodOf, type SupabaseCall, type SupabaseResult } from '@/test/supabase-fake'

export type MemoryRow = Record<string, unknown>
export type MemoryTables = Record<string, MemoryRow[]>

type Options = {
    // The unique indexes of a table, each a list of columns.
    unique?: Record<string, string[][]>
    defaults?: Record<string, () => MemoryRow>
    // Runs before a call touches the rows: where a test lands what another tab does in between, or
    // answers an error of its own.
    before?: (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined | void
    emails?: Record<string, string>
}

const UNIQUE_VIOLATION = { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }

// A database that keeps what is written to it, on the recording client of test/supabase-fake: reads
// and writes answer from the same rows, filters and unique indexes included. Each call lands when it
// is awaited, so two flows run together interleave the way two requests do.
export function memoryDatabase(tables: MemoryTables, { unique = {}, defaults = {}, before, emails = {} }: Options = {}) {
    let drawn = 0
    const rowsOf = (table: string) => (tables[table] ??= [])
    const shape = (calls: readonly SupabaseCall[], rows: MemoryRow[]): SupabaseResult => {
        const copies = rows.map(row => ({ ...row }))
        if (calls.some(call => call.method === 'single')) return copies.length === 1 ? { data: copies[0] } : { data: null, error: { code: 'PGRST116', message: 'not one row' } }
        if (calls.some(call => call.method === 'maybeSingle')) return { data: copies[0] ?? null }
        return { data: copies }
    }
    const matching = (table: string, calls: readonly SupabaseCall[]) => rowsOf(table).filter(row => calls.every(call => keeps(row, call)))

    function read(table: string, calls: readonly SupabaseCall[]): SupabaseResult {
        let rows = matching(table, calls)
        const head = calls.some(call => call.method === 'select' && (call.args[1] as { head?: boolean } | undefined)?.head)
        if (head) return { data: null, count: rows.length }
        for (const call of calls.filter(c => c.method === 'order').reverse()) {
            const [column, options] = call.args as [string, { ascending?: boolean } | undefined]
            const direction = options?.ascending === false ? -1 : 1
            rows = [...rows].sort((a, b) => ((a[column] as number) < (b[column] as number) ? -direction : (a[column] as number) > (b[column] as number) ? direction : 0))
        }
        const range = calls.find(call => call.method === 'range')
        if (range) rows = rows.slice(range.args[0] as number, (range.args[1] as number) + 1)
        const limit = calls.find(call => call.method === 'limit')
        if (limit) rows = rows.slice(0, limit.args[0] as number)
        return shape(calls, rows)
    }

    function insert(table: string, calls: readonly SupabaseCall[], call: SupabaseCall): SupabaseResult {
        drawn += 1
        const row: MemoryRow = { ...defaults[table]?.(), ...(call.args[0] as MemoryRow) }
        if (row.id === undefined) row.id = `${table}-${drawn}`
        const taken = (unique[table] ?? []).some(columns => rowsOf(table).some(other => columns.every(column => row[column] != null && other[column] === row[column])))
        if (taken) return call.method === 'upsert' ? { data: null } : UNIQUE_VIOLATION
        rowsOf(table).push(row)
        return shape(calls, [row])
    }

    // As the RPC does: false while the person's alert under that key is still open.
    function openIncident({ p_user_id, p_source_key }: { p_user_id: string; p_source_key: string }): SupabaseResult {
        const incident = rowsOf('notification_incidents').find(row => row.user_id === p_user_id && row.source_key === p_source_key)
        if (incident && !incident.resolved_at) return { data: false }
        const opened = { opened_at: new Date().toISOString(), resolved_at: null }
        if (incident) Object.assign(incident, opened)
        else rowsOf('notification_incidents').push({ user_id: p_user_id, source_key: p_source_key, ...opened })
        return { data: true }
    }

    const db = fakeSupabase((table, calls) => {
        const planned = before?.(table, calls)
        if (planned) return planned
        if (table === 'rpc:grant_rerun_topup') {
            const { p_workspace_id, p_micros } = calls[0].args[1] as { p_workspace_id: number; p_micros: number }
            const workspace = rowsOf('workspaces').find(row => row.id === p_workspace_id)
            if (workspace) workspace.rerun_topup_micros = (workspace.rerun_topup_micros as number) + p_micros
            return { data: null }
        }
        if (table === 'rpc:email_domain_is_blocked') return { data: false }
        if (table === 'rpc:open_notification_incident') return openIncident(calls[0].args[1] as { p_user_id: string; p_source_key: string })
        const method = writeMethodOf(calls)
        if (!method) return read(table, calls)
        const write = calls.find(call => call.method === method)!
        if (method === 'insert' || method === 'upsert') return insert(table, calls, write)
        const rows = matching(table, calls)
        if (method === 'delete') tables[table] = rowsOf(table).filter(row => !rows.includes(row))
        else for (const row of rows) Object.assign(row, write.args[0] as MemoryRow)
        return shape(calls, rows)
    })
    Object.assign(db.client, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { id, email: emails[id], user_metadata: {}, app_metadata: {} } : null } }) } } })
    return { ...db, tables, rows: rowsOf }
}

export type MemoryDatabase = ReturnType<typeof memoryDatabase>
