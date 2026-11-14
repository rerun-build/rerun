import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Client } from '@libsql/client'
import { z } from 'zod'
import { dbExecuteSchema, dbQuerySchema, rowFilterSchema, rowUpdateSchema, tableSourcesRequestSchema, tableSourcesResultSchema, tableViewInputSchema } from '@rerun/contracts'
import { deleteTableRows, dropTable, executeStore, exportTableRows, groupTableRows, listTables, purgeTable, queryStore, readTableRows, updateTableRow } from '../../db/sqlStore.js'
import { deleteTableViews, deleteView, listViews, saveView } from '../../db/tableViews.js'
import { lookupPaidSources } from '../../db/repos/paid-sources.js'

const MAX_GROUPS = 50

function parseColumns(raw: string | undefined): string[] | undefined {
    if (!raw) return undefined
    const cols = raw.split(',').map(s => s.trim()).filter(Boolean)
    return cols.length > 0 ? cols : undefined
}

function parseWhere(raw: string | undefined) {
    if (!raw) return undefined
    return z.array(rowFilterSchema).parse(JSON.parse(raw))
}

function failure(c: Context, err: unknown, fallback: string) {
    return c.json({ error: err instanceof Error && err.message ? err.message : fallback }, 400)
}

function toCsvValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
    return str
}

export function createDataRouter(getClient: (c: Context) => Promise<Client>, hidden: string[] = [], sourceAgentIds?: (c: Context) => string[] | Promise<string[]>): Hono {
    const routes = new Hono()

    if (sourceAgentIds) {
        routes.post('/sources', async c => {
            const { rows } = tableSourcesRequestSchema.parse(await c.req.json())
            return c.json(tableSourcesResultSchema.parse(await lookupPaidSources(await sourceAgentIds(c), rows)))
        })
    }

    routes.get('/tables', async c => {
        return c.json({ tables: await listTables(await getClient(c), hidden) })
    })

    routes.post('/query', async c => {
        const client = await getClient(c)
        const { sql, params, limit } = dbQuerySchema.parse(await c.req.json())
        try {
            return c.json(await queryStore(client, sql, params, limit))
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : 'Query failed' }, 400)
        }
    })

    routes.post('/execute', async c => {
        const client = await getClient(c)
        const input = dbExecuteSchema.parse(await c.req.json())
        try {
            return c.json(await executeStore(client, input))
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : 'Execution failed' }, 400)
        }
    })

    routes.get('/tables/:name/rows', async c => {
        const client = await getClient(c)
        const name = c.req.param('name')!
        const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 500)
        const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)
        const sort = c.req.query('sort') || undefined
        const dir = c.req.query('dir') || undefined
        const q = c.req.query('q') || undefined
        const columns = parseColumns(c.req.query('columns'))
        const where = parseWhere(c.req.query('where'))
        return c.json(await readTableRows(client, name, { limit, offset, sort, dir, q, where, columns, hidden }))
    })

    routes.get('/tables/:name/groups', async c => {
        const client = await getClient(c)
        const groupBy = c.req.query('groupBy')
        if (!groupBy) return c.json({ error: 'groupBy is required' }, 400)
        try {
            const groups = await groupTableRows(client, c.req.param('name')!, {
                groupBy,
                sumColumn: c.req.query('sum') || undefined,
                where: parseWhere(c.req.query('where')),
                q: c.req.query('q') || undefined,
                limit: MAX_GROUPS,
                hidden,
            })
            return c.json({ groups })
        } catch (err) {
            return failure(c, err, 'Could not group rows')
        }
    })

    routes.patch('/tables/:name/rows/:rowid', async c => {
        const client = await getClient(c)
        const { values } = rowUpdateSchema.parse(await c.req.json())
        try {
            return c.json({ row: await updateTableRow(client, c.req.param('name')!, c.req.param('rowid')!, values, hidden) })
        } catch (err) {
            return failure(c, err, 'Could not update the row')
        }
    })

    routes.get('/tables/:name/views', async c => {
        const client = await getClient(c)
        try {
            return c.json({ views: await listViews(client, c.req.param('name')!, hidden) })
        } catch (err) {
            return failure(c, err, 'Could not read the views')
        }
    })

    routes.post('/tables/:name/views', async c => {
        const client = await getClient(c)
        const input = tableViewInputSchema.parse(await c.req.json())
        try {
            return c.json({ view: await saveView(client, c.req.param('name')!, input, { hidden }) })
        } catch (err) {
            return failure(c, err, 'Could not save the view')
        }
    })

    routes.put('/tables/:name/views/:id', async c => {
        const client = await getClient(c)
        const input = tableViewInputSchema.parse(await c.req.json())
        try {
            return c.json({ view: await saveView(client, c.req.param('name')!, input, { id: c.req.param('id')!, hidden }) })
        } catch (err) {
            return failure(c, err, 'Could not save the view')
        }
    })

    routes.delete('/tables/:name/views/:id', async c => {
        const client = await getClient(c)
        await deleteView(client, c.req.param('name')!, c.req.param('id')!)
        return c.body(null, 204)
    })

    routes.delete('/tables/:name/rows', async c => {
        const client = await getClient(c)
        const name = c.req.param('name')!
        const body = (await c.req.json().catch(() => ({}))) as { rowids?: unknown }
        const rowids = Array.isArray(body.rowids)
            ? body.rowids.filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
            : []
        return c.json(await deleteTableRows(client, name, rowids, hidden))
    })

    routes.post('/tables/:name/purge', async c => {
        const client = await getClient(c)
        return c.json(await purgeTable(client, c.req.param('name')!, hidden))
    })

    routes.delete('/tables/:name', async c => {
        const client = await getClient(c)
        const name = c.req.param('name')!
        await dropTable(client, name, hidden)
        await deleteTableViews(client, name)
        return c.body(null, 204)
    })

    routes.get('/tables/:name/export', async c => {
        const client = await getClient(c)
        const name = c.req.param('name')!
        const format = c.req.query('format') === 'json' ? 'json' : 'csv'
        const sort = c.req.query('sort') || undefined
        const dir = c.req.query('dir') || undefined
        const q = c.req.query('q') || undefined
        const where = parseWhere(c.req.query('where'))
        const requestedColumns = parseColumns(c.req.query('columns'))
        const { columns, rows } = await exportTableRows(client, name, { sort, dir, q, where, columns: requestedColumns, hidden })
        const filename = `${name}.${format}`
        if (format === 'json') {
            c.header('Content-Type', 'application/json; charset=utf-8')
            c.header('Content-Disposition', `attachment; filename="${filename}"`)
            return c.body(JSON.stringify(rows, null, 2))
        }
        const header = columns.map(toCsvValue).join(',')
        const lines = rows.map(row => columns.map(col => toCsvValue(row[col])).join(','))
        c.header('Content-Type', 'text/csv; charset=utf-8')
        c.header('Content-Disposition', `attachment; filename="${filename}"`)
        return c.body([header, ...lines].join('\n'))
    })

    return routes
}
