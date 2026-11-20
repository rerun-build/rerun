import { mkdirSync } from 'node:fs'
import { createClient, type Client } from '@libsql/client'

const pool = new Map<string, Client>()
const opening = new Map<string, Promise<Client>>()

async function open(key: string, file: string, dir: string): Promise<Client> {
    mkdirSync(dir, { recursive: true })
    const client = createClient({ url: `file:${file}`, timeout: 5000 })
    try {
        await client.execute('PRAGMA journal_mode = WAL')
        await client.execute('PRAGMA synchronous = NORMAL')
    } catch (e) {
        client.close()
        throw e
    }
    pool.set(key, client)
    return client
}

export async function openStore(key: string, file: string, dir: string): Promise<Client> {
    const cached = pool.get(key)
    if (cached) return cached
    const inflight = opening.get(key)
    if (inflight) return inflight
    const promise = open(key, file, dir).finally(() => opening.delete(key))
    opening.set(key, promise)
    return promise
}

export function closeStore(key: string): void {
    const client = pool.get(key)
    if (!client) return
    pool.delete(key)
    try {
        client.close()
    } catch {}
}

export async function checkpointStore(client: Client): Promise<void> {
    try {
        await client.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {}
}

const BUSY = /SQLITE_BUSY|database is locked/i
const RETRY_DELAYS = [25, 60, 150]

export async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn()
        } catch (e) {
            const message = (e as Error).message ?? ''
            if (attempt >= RETRY_DELAYS.length || !BUSY.test(message)) throw e
            const delay = RETRY_DELAYS[attempt] * (1 + Math.random())
            await new Promise(r => setTimeout(r, delay))
        }
    }
}

export function serializeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Uint8Array) return `<blob ${value.length} bytes>`
    if (value instanceof ArrayBuffer) return `<blob ${value.byteLength} bytes>`
    return value
}

export function serializeRow(columns: string[], row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const col of columns) out[col] = serializeValue(row[col])
    return out
}

export type DbColumn = { name: string; type: string; pk: boolean; notnull: boolean }
export type DbTable = { name: string; columns: DbColumn[] }

async function tableNames(client: Client, hidden: string[] = []): Promise<string[]> {
    const rs = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    return rs.rows.map(r => String(r.name)).filter(name => !hidden.includes(name))
}

async function tableHasRowid(client: Client, table: string): Promise<boolean> {
    const rs = await client.execute({ sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", args: [table] })
    const sql = rs.rows[0]?.sql
    if (typeof sql !== 'string') return true
    return !/without\s+rowid/i.test(sql)
}

async function columnsOf(client: Client, table: string): Promise<DbColumn[]> {
    const rs = await client.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
    return rs.rows.map(r => ({
        name: String(r.name),
        type: String(r.type ?? ''),
        pk: Number(r.pk) > 0,
        notnull: Number(r.notnull) > 0,
    }))
}

export async function listTables(client: Client, hidden: string[] = []): Promise<DbTable[]> {
    const names = await tableNames(client, hidden)
    const tables: DbTable[] = []
    for (const name of names) tables.push({ name, columns: await columnsOf(client, name) })
    return tables
}

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`
}

export type RowFilter = { column: string; equals: SqlParam }

function buildWhere(allColumns: DbColumn[], searched: DbColumn[], q: string | undefined, where: RowFilter[] = []): { clause: string; args: SqlParam[] } {
    const conditions: string[] = []
    const args: SqlParam[] = []
    for (const { column, equals } of where) {
        if (!allColumns.some(c => c.name === column)) throw new Error(`Column not found: ${column}`)
        if (equals === null) {
            conditions.push(`${quoteIdent(column)} IS NULL`)
        } else {
            conditions.push(`${quoteIdent(column)} = ?`)
            args.push(equals)
        }
    }
    const term = q?.trim()
    if (term && searched.length > 0) {
        conditions.push(`(${searched.map(c => `CAST(${quoteIdent(c.name)} AS TEXT) LIKE ?`).join(' OR ')})`)
        args.push(...searched.map(() => `%${term}%`))
    }
    return { clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '', args }
}

function buildOrder(columns: DbColumn[], sort: string | undefined, dir: string | undefined): string {
    if (!sort || !columns.some(c => c.name === sort)) return ''
    const direction = dir === 'desc' ? 'DESC' : 'ASC'
    return ` ORDER BY ${quoteIdent(sort)} ${direction}`
}

function projectColumns(columns: DbColumn[], requested: string[] | undefined): DbColumn[] {
    if (!requested || requested.length === 0) return columns
    const byName = new Map(columns.map(c => [c.name, c]))
    const picked = requested.map(name => byName.get(name)).filter((c): c is DbColumn => c !== undefined)
    return picked.length > 0 ? picked : columns
}

function buildSelect(columns: DbColumn[]): string {
    return columns.map(c => quoteIdent(c.name)).join(', ')
}

async function requireTable(client: Client, table: string, hidden: string[]): Promise<void> {
    const names = await tableNames(client, hidden)
    if (!names.includes(table)) throw new Error(`Table not found: ${table}`)
}

export async function tableColumns(client: Client, table: string, hidden: string[] = []): Promise<DbColumn[]> {
    await requireTable(client, table, hidden)
    return columnsOf(client, table)
}

export type ReadRowsOptions = { limit: number; offset: number; sort?: string; dir?: string; q?: string; where?: RowFilter[]; columns?: string[]; hidden?: string[] }

export async function readTableRows(
    client: Client,
    table: string,
    { limit, offset, sort, dir, q, where, columns: requestedColumns, hidden = [] }: ReadRowsOptions
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; total: number }> {
    await requireTable(client, table, hidden)
    const quoted = quoteIdent(table)
    const allColumns = await columnsOf(client, table)
    const selected = projectColumns(allColumns, requestedColumns)
    const search = buildWhere(allColumns, selected, q, where)
    const order = buildOrder(allColumns, sort, dir)
    const hasRowid = await tableHasRowid(client, table)
    const selectExpr = `${hasRowid ? 'rowid AS "__rowid", ' : ''}${buildSelect(selected)}`
    const count = await client.execute({ sql: `SELECT count(*) AS n FROM ${quoted}${search.clause}`, args: [...search.args] })
    const total = Number(count.rows[0]?.n ?? 0)
    const rs = await client.execute({ sql: `SELECT ${selectExpr} FROM ${quoted}${search.clause}${order} LIMIT ? OFFSET ?`, args: [...search.args, limit, offset] })
    const visibleColumns = rs.columns.filter(c => c !== '__rowid')
    const rows = (rs.rows as unknown as Record<string, unknown>[]).map(r => serializeRow(rs.columns, r))
    return { columns: visibleColumns, rows, total }
}

export type GroupRowsOptions = { groupBy: string; sumColumn?: string; where?: RowFilter[]; q?: string; limit: number; hidden?: string[] }
export type RowGroup = { value: SqlParam; total: number; sum?: number }

export async function groupTableRows(client: Client, table: string, { groupBy, sumColumn, where, q, limit, hidden = [] }: GroupRowsOptions): Promise<RowGroup[]> {
    await requireTable(client, table, hidden)
    const allColumns = await columnsOf(client, table)
    for (const column of [groupBy, sumColumn]) {
        if (column !== undefined && !allColumns.some(c => c.name === column)) throw new Error(`Column not found: ${column}`)
    }
    const filter = buildWhere(allColumns, allColumns, q, where)
    const sum = sumColumn ? `, sum(${quoteIdent(sumColumn)}) AS sum` : ''
    const rs = await client.execute({
        sql: `SELECT ${quoteIdent(groupBy)} AS value, count(*) AS total${sum} FROM ${quoteIdent(table)}${filter.clause} GROUP BY 1 ORDER BY total DESC LIMIT ?`,
        args: [...filter.args, limit],
    })
    return rs.rows.map(r => ({
        value: serializeValue(r.value) as SqlParam,
        total: Number(r.total),
        ...(sumColumn && r.sum !== null ? { sum: Number(r.sum) } : {}),
    }))
}

export type ExportRowsOptions = { sort?: string; dir?: string; q?: string; where?: RowFilter[]; columns?: string[]; hidden?: string[] }

export async function exportTableRows(
    client: Client,
    table: string,
    { sort, dir, q, where, columns: requestedColumns, hidden = [] }: ExportRowsOptions
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    await requireTable(client, table, hidden)
    const quoted = quoteIdent(table)
    const allColumns = await columnsOf(client, table)
    const selected = projectColumns(allColumns, requestedColumns)
    const search = buildWhere(allColumns, selected, q, where)
    const order = buildOrder(allColumns, sort, dir)
    const rs = await client.execute({ sql: `SELECT ${buildSelect(selected)} FROM ${quoted}${search.clause}${order}`, args: [...search.args] })
    const rows = (rs.rows as unknown as Record<string, unknown>[]).map(r => serializeRow(rs.columns, r))
    return { columns: rs.columns, rows }
}

export async function deleteTableRows(client: Client, table: string, rowids: (number | string)[], hidden: string[] = []): Promise<{ deleted: number }> {
    await requireTable(client, table, hidden)
    if (rowids.length === 0) return { deleted: 0 }
    if (!(await tableHasRowid(client, table))) throw new Error(`Table has no rowid: ${table}`)
    const placeholders = rowids.map(() => '?').join(', ')
    const rs = await withBusyRetry(() => client.execute({ sql: `DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${placeholders})`, args: rowids }))
    return { deleted: rs.rowsAffected ?? 0 }
}

export async function updateTableRow(
    client: Client,
    table: string,
    rowid: number | string,
    values: Record<string, SqlParam>,
    hidden: string[] = []
): Promise<Record<string, unknown>> {
    await requireTable(client, table, hidden)
    if (!(await tableHasRowid(client, table))) throw new Error(`Table has no rowid: ${table}`)
    const allColumns = await columnsOf(client, table)
    const entries = Object.entries(values)
    if (entries.length === 0) throw new Error('Nothing to update.')
    for (const [column] of entries) {
        if (!allColumns.some(c => c.name === column)) throw new Error(`Column not found: ${column}`)
    }
    const quoted = quoteIdent(table)
    const assignments = entries.map(([column]) => `${quoteIdent(column)} = ?`).join(', ')
    const rs = await withBusyRetry(() => client.execute({ sql: `UPDATE ${quoted} SET ${assignments} WHERE rowid = ?`, args: [...entries.map(([, value]) => value), rowid] }))
    if (!rs.rowsAffected) throw new Error('Row not found.')
    const read = await client.execute({ sql: `SELECT rowid AS "__rowid", ${buildSelect(allColumns)} FROM ${quoted} WHERE rowid = ?`, args: [rowid] })
    const row = read.rows[0] as unknown as Record<string, unknown> | undefined
    if (!row) throw new Error('Row not found.')
    return serializeRow(read.columns, row)
}

export async function dropTable(client: Client, table: string, hidden: string[] = []): Promise<void> {
    await requireTable(client, table, hidden)
    await withBusyRetry(() => client.execute(`DROP TABLE ${quoteIdent(table)}`))
}

export async function purgeTable(client: Client, table: string, hidden: string[] = []): Promise<{ deleted: number }> {
    await requireTable(client, table, hidden)
    const rs = await withBusyRetry(() => client.execute(`DELETE FROM ${quoteIdent(table)}`))
    return { deleted: rs.rowsAffected ?? 0 }
}

export type SqlParam = string | number | boolean | null

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|pragma|begin|commit|rollback)\b/i

const STRINGS_AND_COMMENTS = /'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g

function blankSqlStringsAndComments(sql: string): string {
    return sql.replace(STRINGS_AND_COMMENTS, match => (match[0] === "'" ? "''" : ' '))
}

export function blankSqlLiterals(sql: string): string {
    return blankSqlStringsAndComments(sql).replace(/"(?:[^"]|"")*"/g, '""')
}

const FILE_ACCESS_FUNCTIONS = /\b(readfile|writefile|fsdir|load_extension)\b/i
const VACUUM_INTO = /\bvacuum\b[\s\S]*\binto\b/i

const INTERNAL_TABLE_REF = /(?:^|[^A-Za-z0-9_])(?:["`[]?_rerun_\w+["`\]]?)/i

export function assertNoSqlFileAccess(sql: string): void {
    const bare = blankSqlStringsAndComments(sql)
    if (FILE_ACCESS_FUNCTIONS.test(bare) || VACUUM_INTO.test(bare)) throw new Error('File access is not allowed in SQL.')
}

export function assertNoInternalTables(sql: string): void {
    if (INTERNAL_TABLE_REF.test(blankSqlStringsAndComments(sql))) throw new Error('Internal _rerun_* tables cannot be accessed through SQL.')
}

export function assertReadOnlySql(sql: string): void {
    assertNoSqlFileAccess(sql)
    assertNoInternalTables(sql)
    const bare = blankSqlLiterals(sql)
    if (!/^\s*(select|with)\b/i.test(bare)) throw new Error('Only a SELECT (or WITH … SELECT) can run here. Use the execute endpoint to change data.')
    if (WRITE_KEYWORDS.test(bare)) throw new Error('This statement writes. Use the execute endpoint instead.')
}

export function assertNoAttach(sql: string): void {
    assertNoSqlFileAccess(sql)
    assertNoInternalTables(sql)
    const bare = blankSqlLiterals(sql)
    if (/\battach\b/i.test(bare)) throw new Error('ATTACH is not allowed. Each database is reached through its own tools.')
    if (/\bpragma\b/i.test(bare)) throw new Error('PRAGMA statements are not allowed.')
}
export type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }

export async function queryStore(client: Client, sql: string, params: SqlParam[], limit: number): Promise<QueryResult> {
    assertReadOnlySql(sql)
    const rs = await client.execute({ sql, args: params })
    const rows = (rs.rows as unknown as Record<string, unknown>[]).slice(0, limit).map(r => serializeRow(rs.columns, r))
    return { columns: rs.columns, rows, rowCount: rs.rows.length, truncated: rs.rows.length > limit }
}

export type ExecuteInput = { sql?: string; params: SqlParam[]; statements?: { sql: string; params: SqlParam[] }[] }
export type ExecuteResult = { statements: number; rowsAffected: number; lastInsertRowid: string | null }

export async function executeStore(client: Client, input: ExecuteInput): Promise<ExecuteResult> {
    if (input.statements && input.statements.length > 0) {
        for (const s of input.statements) assertNoAttach(s.sql)
        const results = await withBusyRetry(() =>
            client.batch(
                input.statements!.map(s => ({ sql: s.sql, args: s.params })),
                'write'
            )
        )
        return { statements: results.length, rowsAffected: results.reduce((n, r) => n + r.rowsAffected, 0), lastInsertRowid: null }
    }
    if (!input.sql) throw new Error('Provide either sql or statements.')
    assertNoAttach(input.sql)
    const rs = await withBusyRetry(() => client.execute({ sql: input.sql!, args: input.params }))
    return { statements: 1, rowsAffected: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid?.toString() ?? null }
}

export type SchemaOptions = { maxTables?: number; maxChars?: number; annotate?: (table: string) => string; more?: (count: number) => string }

export function formatSchema(tables: DbTable[], { maxTables, maxChars, annotate, more }: SchemaOptions = {}): string {
    if (tables.length === 0) return ''
    const kept = maxTables ? tables.slice(0, maxTables) : tables
    const lines = kept.map(t => {
        const cols = t.columns.map(c => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`.trim())
        const suffix = annotate?.(t.name) ?? ''
        return `${t.name}(${cols.join(', ')})${suffix}`
    })
    let text = lines.join('\n')
    let dropped = tables.length - kept.length
    if (maxChars && text.length > maxChars) {
        const fitting: string[] = []
        let size = 0
        for (const line of lines) {
            if (size + line.length + 1 > maxChars) break
            fitting.push(line)
            size += line.length + 1
        }
        dropped = tables.length - fitting.length
        text = fitting.join('\n')
    }
    if (dropped > 0 && more) text = `${text}\n${more(dropped)}`
    return text
}
