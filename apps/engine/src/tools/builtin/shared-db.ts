import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getSharedDb, readSharedDbSchema, recordTableOwnership, SHARED_HIDDEN_TABLES } from '../../db/sharedDb.js'
import { assertNoAttach, assertReadOnlySql, executeStore, listTables, serializeRow } from '../../db/sqlStore.js'
import type { RunContext } from '../../runtime/context.js'

const MAX_OUTPUT = 50_000
const paramSchema = z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([])

const TABLE_IN_ERROR = /\b(?:table|column)\b[^:]*:?\s*"?([A-Za-z_][\w$]*)"?/i

// A failed statement is where an agent finds out the other agents already shaped this table
// differently, so the error carries the current shape back instead of leaving a dead end.
async function withCurrentShape(message: string): Promise<string> {
    const name = TABLE_IN_ERROR.exec(message)?.[1]
    if (!name) return message
    try {
        const tables = await listTables(await getSharedDb(), SHARED_HIDDEN_TABLES)
        const found = tables.find(t => t.name === name)
        if (!found) return message
        return `${message}\nCurrent shape: ${found.name}(${found.columns.map(c => `${c.name} ${c.type}`.trim()).join(', ')})`
    } catch {
        return message
    }
}

export function sharedDbTools(ctx: RunContext): ToolSet {
    const agentName = ctx.agent.config.name
    return {
        shared_db_query: tool({
            description:
                'Run a single read-only SQL SELECT against the shared database of this space and get the rows back as JSON. Every coworker of this space reads and writes this same database, so use it for data other coworkers need. Use ? placeholders with the params array for values instead of concatenating them into the SQL. Call shared_db_schema first when you are unsure which tables exist.',
            inputSchema: z.object({
                sql: z.string().describe('A single SELECT statement. Use ? placeholders for values.'),
                params: paramSchema.describe('Values bound to the ? placeholders, in order'),
                limit: z.number().int().positive().max(1000).default(100).describe('Maximum number of rows to return'),
            }),
            execute: async ({ sql, params, limit }) => {
                try {
                    assertReadOnlySql(sql)
                    const client = await getSharedDb()
                    const rs = await client.execute({ sql, args: params })
                    const rows = (rs.rows as unknown as Record<string, unknown>[]).slice(0, limit).map(r => serializeRow(rs.columns, r))
                    const note = rs.rows.length > limit ? `\n[truncated to ${limit} of ${rs.rows.length} rows]` : ''
                    return `${rs.rows.length} row(s)\n${JSON.stringify(rows)}${note}`.slice(0, MAX_OUTPUT)
                } catch (e) {
                    return `Query failed: ${await withCurrentShape((e as Error).message)}`
                }
            },
        }),
        shared_db_execute: tool({
            description:
                'Execute SQL that changes the shared database of this space: CREATE/ALTER/DROP tables, or INSERT/UPDATE/DELETE rows. Every coworker of this space sees the result immediately, so always CREATE TABLE IF NOT EXISTS, never drop or alter a table you did not create, and never delete rows you did not insert. Pass one statement in sql, or an ordered list in statements to run atomically in one transaction, never both. Use ? placeholders with params for values.',
            inputSchema: z.object({
                sql: z.string().optional().describe('A single SQL statement to run'),
                params: paramSchema.describe('Values bound to ? placeholders in sql, in order'),
                statements: z
                    .array(z.object({ sql: z.string(), params: paramSchema }))
                    .optional()
                    .describe('Several statements to run atomically in one transaction; use instead of sql for migrations'),
            }),
            execute: async ({ sql, params, statements }) => {
                try {
                    const client = await getSharedDb()
                    const result = await executeStore(client, { sql, params, statements })
                    await recordTableOwnership(client, statements?.map(s => s.sql) ?? (sql ? [sql] : []), agentName)
                    const lastId = result.lastInsertRowid !== null ? `, lastInsertRowid=${result.lastInsertRowid}` : ''
                    return `OK, ${result.statements} statement(s), ${result.rowsAffected} row(s) affected${lastId}`
                } catch (e) {
                    return `Execution failed: ${await withCurrentShape((e as Error).message)}`
                }
            },
        }),
        shared_db_schema: tool({
            description: 'Inspect the current structure of the shared database of this space: every table with its columns, types, and the coworker that created it. Call this before creating a table, so you extend what another coworker already built instead of clashing with it.',
            inputSchema: z.object({}),
            execute: async () => {
                try {
                    const schema = await readSharedDbSchema()
                    return schema || 'The shared database has no tables yet. Create one with shared_db_execute (CREATE TABLE IF NOT EXISTS ...).'
                } catch (e) {
                    return `Schema read failed: ${(e as Error).message}`
                }
            },
        }),
    }
}
