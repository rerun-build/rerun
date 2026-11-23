import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getAgentDb, readAgentDbSchema } from '../../db/agentDb.js'
import { assertNoAttach, executeStore, serializeRow } from '../../db/sqlStore.js'
import type { RunContext } from '../../runtime/context.js'

const MAX_OUTPUT = 50_000
const paramSchema = z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([])

export function dbTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    return {
        db_query: tool({
            description:
                'Run a single read-only SQL SELECT against your own private SQLite database and get the rows back as JSON. Use ? placeholders with the params array for values instead of concatenating them into the SQL. This database is yours alone and persists across conversations. Create or change tables with db_execute first.',
            inputSchema: z.object({
                sql: z.string().describe('A single SELECT statement. Use ? placeholders for values.'),
                params: paramSchema.describe('Values bound to the ? placeholders, in order'),
                limit: z.number().int().positive().max(1000).default(100).describe('Maximum number of rows to return'),
            }),
            execute: async ({ sql, params, limit }) => {
                try {
                    assertNoAttach(sql)
                    const client = await getAgentDb(id)
                    const rs = await client.execute({ sql, args: params })
                    const rows = (rs.rows as unknown as Record<string, unknown>[]).slice(0, limit).map(r => serializeRow(rs.columns, r))
                    const note = rs.rows.length > limit ? `\n[truncated to ${limit} of ${rs.rows.length} rows]` : ''
                    return `${rs.rows.length} row(s)\n${JSON.stringify(rows)}${note}`.slice(0, MAX_OUTPUT)
                } catch (e) {
                    return `Query failed: ${(e as Error).message}`
                }
            },
        }),
        db_execute: tool({
            description:
                'Execute SQL that changes your private database: CREATE/ALTER/DROP tables, or INSERT/UPDATE/DELETE rows. Pass one statement in sql, or an ordered list in statements to run atomically in one transaction (a CREATE TABLE and its INSERTs), never both. Use ? placeholders with params for values.',
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
                    const result = await executeStore(await getAgentDb(id), { sql, params, statements })
                    const lastId = result.lastInsertRowid !== null ? `, lastInsertRowid=${result.lastInsertRowid}` : ''
                    return `OK, ${result.statements} statement(s), ${result.rowsAffected} row(s) affected${lastId}`
                } catch (e) {
                    return `Execution failed: ${(e as Error).message}`
                }
            },
        }),
        db_schema: tool({
            description: 'Inspect the current structure of your private database: every table with its columns and types. Call this when you are unsure what tables or columns exist.',
            inputSchema: z.object({}),
            execute: async () => {
                try {
                    const schema = await readAgentDbSchema(id)
                    return schema || 'Your database has no tables yet. Create one with db_execute (CREATE TABLE ...).'
                } catch (e) {
                    return `Schema read failed: ${(e as Error).message}`
                }
            },
        }),
    }
}
