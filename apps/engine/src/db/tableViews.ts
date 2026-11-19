import { randomUUID } from 'node:crypto'
import type { Client } from '@libsql/client'
import { CARD_FIELD_ROLES, CARD_FORMATS, isCardFormat, tableViewConfigSchema, type TableView, type TableViewConfig, type TableViewInput } from '@moldwright/contracts'
import { tableColumns, withBusyRetry } from './sqlStore.js'

export const VIEWS_TABLE = '_rerun_views'

const VIEWS_DDL = `CREATE TABLE IF NOT EXISTS ${VIEWS_TABLE} (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, config TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (table_name, name))`

const MISSING_TABLE = /no such table/i

type ViewColumns = Pick<TableViewConfig, 'layout' | 'columns' | 'fields' | 'formats' | 'groupBy' | 'sort' | 'where'>

export function checkViewColumns(table: string, allColumns: string[], view: ViewColumns): void {
    const requireColumn = (column: string, where: string) => {
        if (!allColumns.includes(column)) throw new Error(`Unknown column "${column}" in ${where}. Columns of ${table}: ${allColumns.join(', ')}`)
    }
    for (const [role, column] of Object.entries(view.fields ?? {})) if (column) requireColumn(column, `fields.${role}`)
    for (const [column, format] of Object.entries(view.formats ?? {})) {
        requireColumn(column, 'formats')
        if (!isCardFormat(format)) throw new Error(`Unknown format "${format}" for ${column}. Use one of ${CARD_FORMATS.join(', ')}, or currency:XXX with an ISO code.`)
    }
    for (const column of view.columns ?? []) requireColumn(column, 'columns')
    for (const filter of view.where ?? []) requireColumn(filter.column, 'where')
    if (view.sort) requireColumn(view.sort.column, 'sort')
    if (view.groupBy) requireColumn(view.groupBy, 'groupBy')
    if (view.layout !== 'table' && !view.fields?.title) throw new Error(`A ${view.layout} needs fields.title, the column each item is named by.`)
    if (view.layout === 'board' && !view.groupBy) throw new Error('A board needs groupBy, the column whose values become its columns.')
}

function sanitize(config: TableViewConfig, allColumns: string[]): TableViewConfig {
    const known = (column: string | undefined) => column !== undefined && allColumns.includes(column)
    const fields = Object.fromEntries(CARD_FIELD_ROLES.filter(role => known(config.fields?.[role])).map(role => [role, config.fields![role]]))
    const formats = Object.fromEntries(Object.entries(config.formats ?? {}).filter(([column, format]) => known(column) && isCardFormat(format)))
    const groupBy = known(config.groupBy) ? config.groupBy : undefined
    const broken = (config.layout !== 'table' && !fields.title) || (config.layout === 'board' && !groupBy)
    return {
        ...config,
        layout: broken ? 'table' : config.layout,
        columns: config.columns?.filter(known),
        fields,
        formats,
        groupBy,
        sort: config.sort && known(config.sort.column) ? config.sort : undefined,
        where: config.where?.filter(filter => known(filter.column)),
    }
}

function configOf(input: TableViewInput): TableViewConfig {
    const { name: _name, ...config } = input
    return tableViewConfigSchema.parse(config)
}

type ViewRow = { id: string; table_name: string; name: string; position: number; config: string }

function toView(row: ViewRow, allColumns: string[]): TableView | null {
    let raw: unknown
    try {
        raw = JSON.parse(row.config)
    } catch {
        return null
    }
    const parsed = tableViewConfigSchema.safeParse(raw)
    if (!parsed.success) return null
    return { id: row.id, table: row.table_name, name: row.name, position: Number(row.position), ...sanitize(parsed.data, allColumns) }
}

async function readRows(client: Client, sql: string, args: (string | number)[]): Promise<ViewRow[]> {
    try {
        const rs = await client.execute({ sql, args })
        return rs.rows as unknown as ViewRow[]
    } catch (e) {
        if (MISSING_TABLE.test((e as Error).message ?? '')) return []
        throw e
    }
}

export async function listViews(client: Client, table: string, hidden: string[] = []): Promise<TableView[]> {
    const allColumns = (await tableColumns(client, table, hidden)).map(c => c.name)
    const rows = await readRows(client, `SELECT id, table_name, name, position, config FROM ${VIEWS_TABLE} WHERE table_name = ? ORDER BY position, name`, [table])
    return rows.map(row => toView(row, allColumns)).filter((view): view is TableView => view !== null)
}

export async function findView(client: Client, table: string, name: string, hidden: string[] = []): Promise<TableView | undefined> {
    const views = await listViews(client, table, hidden)
    return views.find(view => view.name === name) ?? views.find(view => view.name.toLowerCase() === name.toLowerCase())
}

export async function viewNamesByTable(client: Client): Promise<Map<string, string[]>> {
    const rows = await readRows(client, `SELECT table_name, name, config FROM ${VIEWS_TABLE} ORDER BY position, name`, []).catch(() => [])
    const byTable = new Map<string, string[]>()
    for (const row of rows) {
        let layout = 'table'
        try {
            layout = tableViewConfigSchema.parse(JSON.parse(row.config)).layout
        } catch {}
        byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), `${row.name} (${layout})`])
    }
    return byTable
}

type SaveOptions = { id?: string; hidden?: string[]; replaceByName?: boolean }

export async function saveView(client: Client, table: string, input: TableViewInput, { id, hidden = [], replaceByName = false }: SaveOptions = {}): Promise<TableView> {
    const allColumns = (await tableColumns(client, table, hidden)).map(c => c.name)
    const config = configOf(input)
    checkViewColumns(table, allColumns, config)
    const now = new Date().toISOString()
    const json = JSON.stringify(config)

    await withBusyRetry(() => client.execute(VIEWS_DDL))
    const clash = await client.execute({ sql: `SELECT id FROM ${VIEWS_TABLE} WHERE table_name = ? AND name = ?`, args: [table, input.name] })
    const clashId = clash.rows[0]?.id as string | undefined

    const replacing = replaceByName && !id
    if (clashId && clashId !== id && !replacing) throw new Error(`A view named "${input.name}" already exists on ${table}.`)

    let viewId: string
    if (id) {
        const rs = await withBusyRetry(() =>
            client.execute({ sql: `UPDATE ${VIEWS_TABLE} SET name = ?, config = ?, updated_at = ? WHERE id = ? AND table_name = ?`, args: [input.name, json, now, id, table] })
        )
        if (!rs.rowsAffected) throw new Error('View not found.')
        viewId = id
    } else if (clashId) {
        await withBusyRetry(() => client.execute({ sql: `UPDATE ${VIEWS_TABLE} SET config = ?, updated_at = ? WHERE id = ?`, args: [json, now, clashId] }))
        viewId = clashId
    } else {
        viewId = randomUUID()
        await withBusyRetry(() =>
            client.execute({
                sql: `INSERT INTO ${VIEWS_TABLE} (id, table_name, name, position, config, updated_at) VALUES (?, ?, ?, (SELECT coalesce(max(position), -1) + 1 FROM ${VIEWS_TABLE} WHERE table_name = ?), ?, ?)`,
                args: [viewId, table, input.name, table, json, now],
            })
        )
    }

    const saved = (await listViews(client, table, hidden)).find(view => view.id === viewId)
    if (!saved) throw new Error('View not found.')
    return saved
}

export async function deleteView(client: Client, table: string, idOrName: string): Promise<boolean> {
    try {
        const rs = await withBusyRetry(() => client.execute({ sql: `DELETE FROM ${VIEWS_TABLE} WHERE table_name = ? AND (id = ? OR name = ?)`, args: [table, idOrName, idOrName] }))
        return rs.rowsAffected > 0
    } catch (e) {
        if (MISSING_TABLE.test((e as Error).message ?? '')) return false
        throw e
    }
}

export async function deleteTableViews(client: Client, table: string): Promise<void> {
    try {
        await withBusyRetry(() => client.execute({ sql: `DELETE FROM ${VIEWS_TABLE} WHERE table_name = ?`, args: [table] }))
    } catch (e) {
        if (!MISSING_TABLE.test((e as Error).message ?? '')) throw e
    }
}
